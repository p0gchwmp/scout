import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  applications,
  candidateClaims,
  companySources,
  contactEvidence,
  jobs,
  jobSnapshots,
  profileEvidence,
  syncRuns,
} from "../../../../db/schema";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { buildApplicationPreparation } from "../../../../lib/scout/application-prep";
import { evaluateResumeAlignment } from "../../../../lib/scout/resume-alignment";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const MAX_RESOLUTIONS_PER_RUN = 12;
const MAX_APPLICATION_PREP_PER_RUN = 24;
const MAX_CONTACT_RESEARCH_PER_RUN = 6;

function shortError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown failure").replace(/\s+/g, " ").trim().slice(0, 180);
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  try {
    const db = getDb();
    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const discovery = await client.discoverInternships();
    const discoveredJobIds: string[] = [];
    let created = 0;
    let existing = 0;

    for (const lead of discovery.leads) {
      const [found] = await db.select().from(jobs).where(eq(jobs.canonicalUrl, lead.canonicalUrl)).limit(1);
      if (found) {
        discoveredJobIds.push(found.id);
        existing += 1;
        continue;
      }
      const id = crypto.randomUUID();
      const observedAt = discovery.observedAt || new Date().toISOString();
      await db.insert(jobs).values({
        id,
        source: `lead:agent:${lead.provider}`,
        sourceRegistryId: null,
        externalId: crypto.randomUUID(),
        canonicalUrl: lead.canonicalUrl,
        company: lead.company,
        title: lead.title,
        description: "",
        location: lead.location,
        workplaceType: "unspecified",
        score: 0,
        scoreExplanation: [`Discovered by signed Scout cloud agent from controlled public ${lead.provider} source`],
        eligibilityRisks: ["Official immutable posting snapshot required before application preparation"],
        state: "saved",
        lifecycleState: "active",
        fingerprint: `agent-lead|${lead.canonicalUrl}`,
        postedAt: lead.postedAt,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        missingCount: 0,
        currentSnapshotId: null,
      });
      discoveredJobIds.push(id);
      created += 1;
    }

    const discoveredJobs = discoveredJobIds.length
      ? await db.select().from(jobs).where(inArray(jobs.id, discoveredJobIds))
      : [];
    const unresolved = discoveredJobs
      .filter((job) => !job.currentSnapshotId && job.source.startsWith("lead:agent:"))
      .slice(0, MAX_RESOLUTIONS_PER_RUN);

    const resolvedJobIds: string[] = [];
    const resolutionFailures: Array<{ jobId: string; reason: string }> = [];
    let resolved = 0;

    for (const lead of unresolved) {
      try {
        const resolveInput = { canonicalUrl: lead.canonicalUrl, company: lead.company, title: lead.title };
        const official = await client.resolveJob(resolveInput);
        const [registered] = await db.select().from(companySources).where(and(
          eq(companySources.provider, official.source.provider),
          eq(companySources.boardToken, official.source.boardToken),
        )).limit(1);
        if (registered && !registered.enabled) {
          resolutionFailures.push({ jobId: lead.id, reason: "Registered source is disabled" });
          continue;
        }
        const source = registered ?? (await db.insert(companySources).values(official.source).returning())[0];
        if (!source) throw new Error("Unable to register controlled source");

        const observedAt = official.resolvedAt || new Date().toISOString();
        const runId = crypto.randomUUID();
        const snapshotId = crypto.randomUUID();
        await db.batch([
          db.insert(syncRuns).values({
            id: runId,
            sourceId: source.id,
            idempotencyKey: `agent-resolution:${lead.id}:${official.contentHash.slice(0, 16)}`,
            status: "completed",
            observedAt,
            discoveredCount: 1,
            updatedCount: 1,
            completedAt: observedAt,
            error: null,
          }),
          db.insert(jobSnapshots).values({
            id: snapshotId,
            jobId: lead.id,
            syncRunId: runId,
            version: 1,
            contentHash: official.contentHash,
            canonicalUrl: official.snapshot.canonicalUrl,
            company: official.snapshot.company,
            title: official.snapshot.title,
            description: official.snapshot.description,
            location: official.snapshot.location,
            workplaceType: official.snapshot.workplaceType,
            score: official.snapshot.score,
            scoreExplanation: official.snapshot.scoreExplanation,
            eligibilityRisks: official.snapshot.eligibilityRisks,
            postedAt: official.snapshot.postedAt,
            capturedAt: observedAt,
          }),
          db.update(jobs).set({
            source: official.source.provider,
            sourceRegistryId: source.id,
            externalId: official.snapshot.externalId,
            canonicalUrl: official.snapshot.canonicalUrl,
            company: official.snapshot.company,
            title: official.snapshot.title,
            description: official.snapshot.description,
            location: official.snapshot.location,
            workplaceType: official.snapshot.workplaceType,
            score: official.snapshot.score,
            scoreExplanation: official.snapshot.scoreExplanation,
            eligibilityRisks: official.snapshot.eligibilityRisks,
            postedAt: official.snapshot.postedAt,
            fingerprint: `${source.id}|${official.snapshot.externalId}`,
            currentSnapshotId: snapshotId,
            lastSeenRunId: runId,
            lastSeenAt: observedAt,
          }).where(eq(jobs.id, lead.id)),
        ]);
        resolvedJobIds.push(lead.id);
        resolved += 1;
      } catch (error) {
        resolutionFailures.push({ jobId: lead.id, reason: shortError(error) });
      }
    }

    const [fields, claims, currentApplications] = await Promise.all([
      db.select().from(profileEvidence),
      db.select().from(candidateClaims),
      db.select().from(applications),
    ]);
    const existingApplicationJobs = new Set(currentApplications.map((item) => item.jobId));
    const candidatesForPrep = (await db.select().from(jobs))
      .filter((job) => job.currentSnapshotId && !existingApplicationJobs.has(job.id))
      .slice(0, MAX_APPLICATION_PREP_PER_RUN);
    let applicationsPrepared = 0;
    let applicationsReady = 0;
    let applicationsNeedInput = 0;

    for (const job of candidatesForPrep) {
      const alignment = evaluateResumeAlignment(job, claims);
      const relevantClaimIds = [...new Set(alignment.supportingClaims.flatMap((support) => support.claimIds))];
      const prepared = buildApplicationPreparation({ job, profileFields: fields, claims, relevantClaimIds });
      await db.insert(applications).values({
        id: crypto.randomUUID(),
        jobId: job.id,
        status: prepared.status,
        blockers: prepared.blockers,
        submittedFields: prepared.packet as unknown as Record<string, string>,
        artifactVersion: 1,
      });
      applicationsPrepared += 1;
      if (prepared.status === "ready_for_review") applicationsReady += 1;
      else applicationsNeedInput += 1;
    }

    const currentJobs = (await db.select().from(jobs))
      .filter((job) => job.currentSnapshotId && job.sourceRegistryId);
    let contactJobsResearched = 0;
    let contactCandidatesSaved = 0;
    let contactsClassified = 0;
    const contactFailures: Array<{ jobId: string; stage: "research" | "classify"; reason: string }> = [];

    for (const job of currentJobs.slice(0, MAX_CONTACT_RESEARCH_PER_RUN)) {
      if (!job.currentSnapshotId || !job.sourceRegistryId) continue;
      const [source] = await db.select().from(companySources).where(eq(companySources.id, job.sourceRegistryId)).limit(1);
      if (!source?.enabled || !source.companyDomain || source.companyDomain.endsWith(".invalid")) continue;
      let contacts = await db.select().from(contactEvidence).where(and(
        eq(contactEvidence.jobId, job.id),
        eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
      ));

      if (!contacts.length) {
        try {
          const research = await client.researchContacts({ companyDomain: source.companyDomain, jobSnapshotId: job.currentSnapshotId });
          contactJobsResearched += 1;
          if (research.candidates.length) {
            await db.batch(research.candidates.map((candidate) => db.insert(contactEvidence).values({
              id: crypto.randomUUID(),
              jobId: job.id,
              jobSnapshotId: job.currentSnapshotId!,
              email: candidate.email,
              sourceUrl: candidate.sourceUrl,
              excerpt: candidate.excerpt,
              sourceType: candidate.sourceType,
              extractedAt: research.researchedAt,
              suitability: "review",
              suitabilityReason: `Published on ${candidate.sourceType}; AI/contact review pending`,
              reviewState: "needs_review",
            }).onConflictDoNothing()) as [ReturnType<typeof db.insert>, ...ReturnType<typeof db.insert>[]]);
            contactCandidatesSaved += research.candidates.length;
          }
          contacts = await db.select().from(contactEvidence).where(and(
            eq(contactEvidence.jobId, job.id),
            eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
          ));
        } catch (error) {
          contactFailures.push({ jobId: job.id, stage: "research", reason: shortError(error) });
          continue;
        }
      }

      const needsAi = contacts.filter((contact) => contact.reviewState === "needs_review" && !/^AI(?: recommends reject)?:/i.test(contact.suitabilityReason));
      if (!needsAi.length) continue;
      try {
        const result = await client.classifyContacts(needsAi.map((contact) => ({
          id: contact.id,
          email: contact.email,
          sourceUrl: contact.sourceUrl,
          excerpt: contact.excerpt,
          sourceType: contact.sourceType,
        })));
        for (const classification of result.classifications) {
          const suitability = classification.suitability === "high" ? "high" : "review";
          const prefix = classification.suitability === "reject" ? "AI recommends reject: " : "AI: ";
          await db.update(contactEvidence).set({
            suitability,
            suitabilityReason: `${prefix}${classification.reason}`.slice(0, 1000),
          }).where(and(
            eq(contactEvidence.id, classification.candidateId),
            eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
            eq(contactEvidence.reviewState, "needs_review"),
          ));
        }
        contactsClassified += result.classifications.length;
      } catch (error) {
        contactFailures.push({ jobId: job.id, stage: "classify", reason: shortError(error) });
      }
    }

    const contactReviewCount = (await db.select().from(contactEvidence))
      .filter((contact) => contact.reviewState === "needs_review").length;
    const applicationReviewCount = (await db.select().from(applications))
      .filter((application) => application.status === "ready_for_review").length;
    const applicationInputCount = (await db.select().from(applications))
      .filter((application) => application.status === "needs_input").length;

    return Response.json({
      run: {
        discovery: {
          found: discovery.found,
          created,
          existing,
          failures: discovery.failures,
          leads: discovery.leads,
        },
        resolution: {
          attempted: unresolved.length,
          resolved,
          deferred: Math.max(0, discoveredJobs.filter((job) => !job.currentSnapshotId && job.source.startsWith("lead:agent:")).length - unresolved.length),
          failures: resolutionFailures,
        },
        applications: {
          prepared: applicationsPrepared,
          readyForReview: applicationsReady,
          needsInput: applicationsNeedInput,
        },
        contacts: {
          jobsResearched: contactJobsResearched,
          candidatesSaved: contactCandidatesSaved,
          classified: contactsClassified,
          failures: contactFailures,
        },
        reviewQueue: {
          applicationsReady: applicationReviewCount,
          applicationsNeedInput: applicationInputCount,
          contactsNeedReview: contactReviewCount,
        },
        limits: {
          resolutions: MAX_RESOLUTIONS_PER_RUN,
          applicationPrep: MAX_APPLICATION_PREP_PER_RUN,
          contactResearch: MAX_CONTACT_RESEARCH_PER_RUN,
        },
        safety: {
          sendEmail: false,
          submitApplication: false,
          autoAcceptContact: false,
          autoApproveApplication: false,
        },
      },
    });
  } catch (error) {
    return scoutServerError("agent.run-now", error, "Run Scout now failed");
  }
}
