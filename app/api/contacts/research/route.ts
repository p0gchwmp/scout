import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companySources, contactEvidence, jobSnapshots, jobs } from "../../../../db/schema";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { parseContactExtractionPayload } from "../../../../lib/scout/api-validation";
import { extractPublishedBusinessEmails } from "../../../../lib/scout/contact-extraction";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

function unresolvedDomain(value: string | null | undefined) {
  return !value || value.endsWith(".invalid");
}

function shortError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown failure").replace(/\s+/g, " ").trim().slice(0, 180);
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseContactExtractionPayload>;
  try { payload = parseContactExtractionPayload(await request.json()); }
  catch { return Response.json({ error: "A valid contact research body is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!job?.sourceRegistryId || !job.currentSnapshotId) {
      return Response.json({ error: "An official synced job snapshot is required before contact research" }, { status: 409 });
    }

    const [[source], [snapshot]] = await Promise.all([
      db.select().from(companySources).where(eq(companySources.id, job.sourceRegistryId)).limit(1),
      db.select().from(jobSnapshots).where(and(eq(jobSnapshots.id, job.currentSnapshotId), eq(jobSnapshots.jobId, job.id))).limit(1),
    ]);
    if (!source?.enabled || !snapshot) {
      return Response.json({ error: "An enabled source and current immutable job snapshot are required" }, { status: 409 });
    }

    const before = await db.select().from(contactEvidence).where(and(
      eq(contactEvidence.jobId, job.id),
      eq(contactEvidence.jobSnapshotId, snapshot.id),
    ));

    // Always inspect the already-persisted official posting first. This is deterministic,
    // provenance-bound and requires no external browsing.
    const extracted = extractPublishedBusinessEmails({
      persistedContent: snapshot.description,
      evidenceUrl: snapshot.canonicalUrl,
      boardToken: source.boardToken,
      externalId: job.externalId,
      companyDomain: source.companyDomain,
      provider: source.provider,
    });
    if (extracted.contacts.length) {
      await db.batch(extracted.contacts.map((contact) => db.insert(contactEvidence).values({
        id: crypto.randomUUID(),
        jobId: job.id,
        jobSnapshotId: snapshot.id,
        ...contact,
      }).onConflictDoNothing()) as [ReturnType<typeof db.insert>, ...ReturnType<typeof db.insert>[]]);
    }

    let externalResearch = false;
    let researchReason = "Official posting checked; external company research was not needed or available.";
    let classificationFailure: string | null = null;

    if (!unresolvedDomain(source.companyDomain)) {
      try {
        const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
        const research = await client.researchContacts({
          companyDomain: source.companyDomain,
          jobSnapshotId: snapshot.id,
          careersUrl: source.careersUrl,
        });
        externalResearch = true;
        researchReason = "Official company-source research completed.";

        if (research.candidates.length) {
          await db.batch(research.candidates.map((candidate) => db.insert(contactEvidence).values({
            id: crypto.randomUUID(),
            jobId: job.id,
            jobSnapshotId: snapshot.id,
            email: candidate.email,
            sourceUrl: candidate.sourceUrl,
            excerpt: candidate.excerpt,
            sourceType: candidate.sourceType,
            extractedAt: research.researchedAt,
            suitability: "review",
            suitabilityReason: `Published on ${candidate.sourceType}; AI/contact review pending`,
            reviewState: "needs_review",
          }).onConflictDoNothing()) as [ReturnType<typeof db.insert>, ...ReturnType<typeof db.insert>[]]);
        }

        const needsClassification = (await db.select().from(contactEvidence).where(and(
          eq(contactEvidence.jobId, job.id),
          eq(contactEvidence.jobSnapshotId, snapshot.id),
        ))).filter((contact) => contact.reviewState === "needs_review" && !/^AI(?: recommends reject)?:/i.test(contact.suitabilityReason));

        if (needsClassification.length) {
          try {
            const classified = await client.classifyContacts(needsClassification.map((contact) => ({
              id: contact.id,
              email: contact.email,
              sourceUrl: contact.sourceUrl,
              excerpt: contact.excerpt,
              sourceType: contact.sourceType,
            })));
            for (const classification of classified.classifications) {
              const suitability = classification.suitability === "high" ? "high" : "review";
              const prefix = classification.suitability === "reject" ? "AI recommends reject: " : "AI: ";
              await db.update(contactEvidence).set({
                suitability,
                suitabilityReason: `${prefix}${classification.reason}`.slice(0, 1000),
              }).where(and(
                eq(contactEvidence.id, classification.candidateId),
                eq(contactEvidence.jobSnapshotId, snapshot.id),
                eq(contactEvidence.reviewState, "needs_review"),
              ));
            }
          } catch (error) {
            classificationFailure = shortError(error);
          }
        }
      } catch (error) {
        researchReason = /cloud agent is not configured/i.test(shortError(error))
          ? "Official posting checked. External company research is unavailable until the Scout cloud agent is configured."
          : `Official posting checked. External company research failed safely: ${shortError(error)}`;
      }
    } else {
      researchReason = "Official posting checked. Resolve a verified company domain before external contact research.";
    }

    const contacts = await db.select().from(contactEvidence).where(and(
      eq(contactEvidence.jobId, job.id),
      eq(contactEvidence.jobSnapshotId, snapshot.id),
    ));
    const beforeIds = new Set(before.map((contact) => contact.id));
    const added = contacts.filter((contact) => !beforeIds.has(contact.id)).length;

    return Response.json({
      jobId: job.id,
      snapshotId: snapshot.id,
      contacts,
      added,
      externalResearch,
      researchReason,
      classificationFailure,
      safety: { emailSent: false, contactAutoAccepted: false },
    });
  } catch (error) {
    return scoutServerError("contacts.targeted-research", error, "Unable to research public contact evidence");
  }
}
