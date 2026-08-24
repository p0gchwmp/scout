import { and, eq, isNull, like } from "drizzle-orm";
import { getDb } from "../../../db";
import { companySources, jobSnapshots, jobs, syncRuns } from "../../../db/schema";
import { resolveControlledLead } from "../../../lib/scout/lead-resolution";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  try {
    const db = getDb();
    const leads = await db.select().from(jobs).where(and(isNull(jobs.currentSnapshotId), like(jobs.source, "lead:%"))).limit(100);
    let resolved = 0;
    let pending = 0;
    const failures: Array<{ jobId: string; reason: string }> = [];

    for (const lead of leads) {
      try {
        const official = await resolveControlledLead(lead.canonicalUrl);
        const [registered] = await db.select().from(companySources).where(and(
          eq(companySources.provider, official.source.provider),
          eq(companySources.boardToken, official.source.boardToken),
        )).limit(1);
        const source = registered ?? (await db.insert(companySources).values(official.source).returning())[0];
        if (!source) throw new Error("Unable to register controlled source");

        const observedAt = new Date().toISOString();
        const runId = crypto.randomUUID();
        const snapshotId = crypto.randomUUID();
        await db.batch([
          db.insert(syncRuns).values({
            id: runId,
            sourceId: source.id,
            idempotencyKey: `lead-resolution:${lead.id}`,
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
            score: 0,
            scoreExplanation: official.snapshot.scoreExplanation,
            eligibilityRisks: official.snapshot.eligibilityRisks,
            postedAt: official.snapshot.postedAt,
            fingerprint: `${source.id}|${official.snapshot.externalId}`,
            currentSnapshotId: snapshotId,
            lastSeenRunId: runId,
            lastSeenAt: observedAt,
          }).where(and(eq(jobs.id, lead.id), isNull(jobs.currentSnapshotId))),
        ]);
        resolved += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Resolution failed";
        if (/not supported for this application channel yet/i.test(message)) pending += 1;
        else failures.push({ jobId: lead.id, reason: message.slice(0, 160) });
      }
    }

    return Response.json({ scanned: leads.length, resolved, pending, failures });
  } catch (error) {
    return scoutServerError("lead-resolution.run", error, "Unable to resolve internship leads");
  }
}
