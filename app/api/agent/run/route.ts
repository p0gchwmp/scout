import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
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
import { sameOpportunityIdentity } from "../../../../lib/scout/opportunity-quality";
import { evaluateResumeAlignment } from "../../../../lib/scout/resume-alignment";
import { createRunBudget, RUN_REQUEST_BUDGET_MS } from "../../../../lib/scout/run-budget";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const MAX_RESOLUTIONS_PER_RUN = 12;
const MAX_APPLICATION_PREP_PER_RUN = 24;
const MAX_DOMAIN_ENRICHMENT_PER_RUN = 8;
const MAX_CONTACT_RESEARCH_PER_RUN = 6;
const DISCOVERY_TIMEOUT_MS = 15_000;
const RESOLUTION_TIMEOUT_MS = 4_000;
const CONTACT_TIMEOUT_MS = 3_000;
const POST_RESOLUTION_WORK_RESERVE_MS = 6_000;
const DB_STEP_RESERVE_MS = 750;

function shortError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown failure").replace(/\s+/g, " ").trim().slice(0, 180);
}

function unresolvedDomain(value: string | null | undefined) {
  return !value || value.endsWith(".invalid");
}

function storedDiscoveryProvider(source: string) {
  if (source === "lead:agent:search_index" || source.startsWith("lead:linkedin") || source.startsWith("lead:internshala") || source.startsWith("lead:form")) {
    return "search_index";
  }
  return source.startsWith("lead:agent:") ? source.slice("lead:agent:".length) : source.startsWith("lead:") ? "search_index" : source;
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  const runBudget = createRunBudget();

  try {
    const db = getDb();
    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const discoveryTimeoutMs = runBudget.boundedAgentTimeout(DISCOVERY_TIMEOUT_MS);
    if (!discoveryTimeoutMs) throw new Error("Scout run time budget was exhausted before discovery");
    const discovery = await client.discoverInternships({ timeoutMs: discoveryTimeoutMs });
    const discoveredJobIds: string[] = [];
    const knownJobs = await db.select().from(jobs);
    let created = 0;
    let existing = 0;
    let duplicatesReused = 0;
    let unresolvedUpgradedToOfficialLead = 0;
    let persistenceDeferred = 0;

    for (const lead of discovery.leads) {
      const found = knownJobs.find((job) => sameOpportunityIdentity({
        provider: storedDiscoveryProvider(job.source),
        canonicalUrl: job.canonicalUrl,
        company: job.company,
        title: job.title,
        location: job.location,
        postedAt: job.postedAt,
      }, {
        provider: lead.provider,
        canonicalUrl: lead.canonicalUrl,
        company: lead.company,
        title: lead.title,
        location: lead.location,
        postedAt: lead.postedAt,
      }));

      if (found) {
        discoveredJobIds.push(found.id);
        existing += 1;
        if (found.canonicalUrl !== lead.canonicalUrl) duplicatesReused += 1;

        if (!found.currentSnapshotId && lead.provider !== "search_index" && found.canonicalUrl !== lead.canonicalUrl && runBudget.canSpend(DB_STEP_RESERVE_MS)) {
          const observedAt = discovery.observedAt || new Date().toISOString();
          const [upgraded] = await db.update(jobs).set({
            source: `lead:agent:${lead.provider}`,
            canonicalUrl: lead.canonicalUrl,
            company: lead.company,
            title: lead.title,
            location: lead.location,
            postedAt: lead.postedAt,
            fingerprint: `agent-lead|${lead.canonicalUrl}`,
            scoreExplanation: [
              `Discovered by signed Scout cloud agent from controlled public ${lead.provider} source`,
              "Duplicate intelligence reused the existing unresolved opportunity and preferred the official ATS lead",
              `Discovery context: ${lead.focus}`.slice(0, 1000),
            ],
            lastSeenAt: observedAt,
          }).where(eq(jobs.id, found.id)).returning();
          if (upgraded) {
            Object.assign(found, upgraded);
            unresolvedUpgradedToOfficialLead += 1;
          }
        } else if (!found.currentSnapshotId && lead.provider !== "search_index" && found.canonicalUrl !== lead.canonicalUrl) {
          persistenceDeferred += 1;
        }
        continue;
      }

      if (!runBudget.canSpend(DB_STEP_RESERVE_MS)) {
        persistenceDeferred += 1;
        continue;
      }
      const id = crypto.randomUUID();
      const observedAt = discovery.observedAt || new Date().toISOString();
      const [inserted] = await db.insert(jobs).values({
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
        scoreExplanation: [
          `Discovered by signed Scout cloud agent from controlled public ${lead.provider} source`,
          `Discovery context: ${lead.focus}`.slice(0, 1000),
          `Resolution policy: ${lead.nextStep}`.slice(0, 1000),
        ],
        eligibilityRisks: ["Official immutable posting snapshot required before application preparation"],
        state: "shortlisted",
        lifecycleState: "active",
        fingerprint: `agent-lead|${lead.canonicalUrl}`,
        postedAt: lead.postedAt,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        missingCount: 0,
        currentSnapshotId: null,
      }).returning();
      if (inserted) knownJobs.push(inserted);
      discoveredJobIds.push(id);
      created += 1;
    }

    const discoveredJobIdSet = new Set(discoveredJobIds);
    const discoveredJobs = knownJobs.filter((job) => discoveredJobIdSet.has(job.id));
    const unresolvedCandidates = discoveredJobs.filter((job) => !job.currentSnapshotId && job.source.startsWith("lead:agent:"));
    const unresolved = unresolvedCandidates.slice(0, MAX_RESOLUTIONS_PER_RUN);

    const resolutionFailures: Array<{ jobId: string; reason: string }> = [];
    let resolved = 0;
    let resolutionAttempted = 0;

    for (const lead of unresolved) {
      if (!runBudget.canSpend(RESOLUTION_TIMEOUT_MS + POST_RESOLUTION_WORK_RESERVE_MS)) break;
      try {
        const resolveInput = { canonicalUrl: lead.canonicalUrl, company: lead.company, title: lead.title };
        resolutionAttempted += 1;
        const official = await client.resolveJob(resolveInput, { timeoutMs: RESOLUTION_TIMEOUT_MS });
        const [registered] = await db.select().from(companySources).where(and(
          eq(companySources.provider, official.source.provider),
          eq(companySources.boardToken, official.source.boardToken),
        )).limit(1);
        if (registered && !registered.enabled) {
          resolutionFailures.push({ jobId: lead.id, reason: "Registered source is disabled" });
          continue;
        }

        let source = registered;
        if (registered && unresolvedDomain(registered.companyDomain) && !unresolvedDomain(official.source.companyDomain)) {
          const [upgraded] = await db.update(companySources).set({
            companyName: official.source.companyName,
            companyDomain: official.source.companyDomain,
            careersUrl: official.source.careersUrl,
          }).where(and(
            eq(companySources.id, registered.id),
            eq(companySources.companyDomain, registered.companyDomain),
          )).returning();
          source = upgraded ?? registered;
        }
        source ??= (await db.insert(companySources).values(official.source).returning())[0];
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
        Object.assign(lead, {
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
        });
        resolved += 1;
      } catch (error) {
        resolutionFailures.push({ jobId: lead.id, reason: shortError(error) });
      }
    }

    const [fields, claims, currentApplications, currentContacts, currentSources] = await Promise.all([
      db.select().from(profileEvidence),
      db.select().from(candidateClaims),
      db.select().from(applications),
      db.select().from(contactEvidence),
      db.select().from(companySources),
    ]);
    const existingApplicationJobs = new Set(currentApplications.map((item) => item.jobId));
    const candidatesForPrep = knownJobs
      .filter((job) => job.currentSnapshotId && !existingApplicationJobs.has(job.id))
      .slice(0, MAX_APPLICATION_PREP_PER_RUN);
    let applicationsPrepared = 0;
    let applicationsReady = 0;
    let applicationsNeedInput = 0;
    let applicationsDeferred = 0;

    for (let applicationIndex = 0; applicationIndex < candidatesForPrep.length; applicationIndex += 1) {
      const job = candidatesForPrep[applicationIndex];
      if (!runBudget.canSpend(DB_STEP_RESERVE_MS)) {
        applicationsDeferred = candidatesForPrep.length - applicationIndex;
        break;
      }
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

    const currentJobs = knownJobs.filter((job) => job.currentSnapshotId && job.sourceRegistryId);
    const sourceById = new Map(currentSources.map((source) => [source.id, source]));
    const domainCandidates: Array<{ job: (typeof currentJobs)[number]; source: typeof companySources.$inferSelect }> = [];
    for (const job of currentJobs) {
      if (!job.sourceRegistryId) continue;
      const source = sourceById.get(job.sourceRegistryId);
      if (source?.enabled && unresolvedDomain(source.companyDomain)) domainCandidates.push({ job, source });
    }

    let domainsEnriched = 0;
    let domainAttempted = 0;
    const domainFailures: Array<{ jobId: string; reason: string }> = [];
    const boundedDomainCandidates = domainCandidates.slice(0, MAX_DOMAIN_ENRICHMENT_PER_RUN);
    for (const { job, source } of boundedDomainCandidates) {
      if (!runBudget.canSpend(RESOLUTION_TIMEOUT_MS + DB_STEP_RESERVE_MS)) break;
      try {
        const domainResolveInput = { canonicalUrl: job.canonicalUrl, company: job.company, title: job.title };
        domainAttempted += 1;
        const official = await client.resolveJob(domainResolveInput, { timeoutMs: RESOLUTION_TIMEOUT_MS });
        if (official.source.provider !== source.provider || official.source.boardToken !== source.boardToken) {
          throw new Error("Domain enrichment resolved to a different ATS source");
        }
        if (unresolvedDomain(official.source.companyDomain)) continue;
        const [upgraded] = await db.update(companySources).set({
          companyName: official.source.companyName,
          companyDomain: official.source.companyDomain,
          careersUrl: official.source.careersUrl,
        }).where(and(
          eq(companySources.id, source.id),
          eq(companySources.companyDomain, source.companyDomain),
        )).returning();
        if (upgraded) {
          domainsEnriched += 1;
          sourceById.set(upgraded.id, upgraded);
        }
      } catch (error) {
        domainFailures.push({ jobId: job.id, reason: shortError(error) });
      }
    }

    let contactJobsResearched = 0;
    let contactCandidatesSaved = 0;
    let contactsClassified = 0;
    const contactFailures: Array<{ jobId: string; stage: "research" | "classify"; reason: string }> = [];
    const contactCandidates = currentJobs.slice(0, MAX_CONTACT_RESEARCH_PER_RUN);
    let contactsDeferred = 0;

    for (let contactIndex = 0; contactIndex < contactCandidates.length; contactIndex += 1) {
      const job = contactCandidates[contactIndex];
      if (!runBudget.canSpend(DB_STEP_RESERVE_MS)) {
        contactsDeferred = contactCandidates.length - contactIndex;
        break;
      }
      if (!job.currentSnapshotId || !job.sourceRegistryId) continue;
      const source = sourceById.get(job.sourceRegistryId);
      if (!source?.enabled || unresolvedDomain(source.companyDomain)) continue;
      let contacts = await db.select().from(contactEvidence).where(and(
        eq(contactEvidence.jobId, job.id),
        eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
      ));

      if (!contacts.length) {
        if (!runBudget.canSpend(CONTACT_TIMEOUT_MS + DB_STEP_RESERVE_MS)) {
          contactsDeferred = contactCandidates.length - contactIndex;
          break;
        }
        try {
          const researchInput = {
            companyDomain: source.companyDomain,
            jobSnapshotId: job.currentSnapshotId,
            careersUrl: source.careersUrl,
          };
          const research = await client.researchContacts(researchInput, { timeoutMs: CONTACT_TIMEOUT_MS });
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
      if (!runBudget.canSpend(CONTACT_TIMEOUT_MS + DB_STEP_RESERVE_MS)) {
        contactsDeferred = Math.max(contactsDeferred, contactCandidates.length - contactIndex);
        break;
      }
      try {
        const result = await client.classifyContacts(needsAi.map((contact) => ({
          id: contact.id,
          email: contact.email,
          sourceUrl: contact.sourceUrl,
          excerpt: contact.excerpt,
          sourceType: contact.sourceType,
        })), { timeoutMs: CONTACT_TIMEOUT_MS });
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

    const contactReviewCount = currentContacts.filter((contact) => contact.reviewState === "needs_review").length + contactCandidatesSaved;
    const applicationReviewCount = currentApplications.filter((application) => application.status === "ready_for_review").length + applicationsReady;
    const applicationInputCount = currentApplications.filter((application) => application.status === "needs_input").length + applicationsNeedInput;
    const resolutionDeferred = Math.max(0, unresolvedCandidates.length - resolutionAttempted);
    const domainPending = Math.max(0, domainCandidates.length - domainAttempted);
    const deferredDueToTime = persistenceDeferred
      + Math.max(0, unresolved.length - resolutionAttempted)
      + applicationsDeferred
      + Math.max(0, boundedDomainCandidates.length - domainAttempted)
      + contactsDeferred;

    return Response.json({
      run: {
        discovery: {
          found: discovery.found,
          created,
          existing,
          duplicatesReused,
          unresolvedUpgradedToOfficialLead,
          deferredPersistence: persistenceDeferred,
          failures: discovery.failures,
          leads: discovery.leads,
        },
        resolution: {
          attempted: resolutionAttempted,
          resolved,
          deferred: resolutionDeferred,
          failures: resolutionFailures,
        },
        applications: {
          prepared: applicationsPrepared,
          readyForReview: applicationsReady,
          needsInput: applicationsNeedInput,
          deferred: applicationsDeferred,
        },
        companyDomains: {
          attempted: domainAttempted,
          enriched: domainsEnriched,
          pending: domainPending,
          failures: domainFailures,
        },
        contacts: {
          jobsResearched: contactJobsResearched,
          candidatesSaved: contactCandidatesSaved,
          classified: contactsClassified,
          deferred: contactsDeferred,
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
          domainEnrichment: MAX_DOMAIN_ENRICHMENT_PER_RUN,
          contactResearch: MAX_CONTACT_RESEARCH_PER_RUN,
        },
        budget: {
          limitMs: RUN_REQUEST_BUDGET_MS,
          elapsedMs: runBudget.elapsedMs(),
          deferredDueToTime,
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
