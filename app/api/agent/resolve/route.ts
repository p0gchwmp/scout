import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companySources, jobSnapshots, jobs, syncRuns } from "../../../../db/schema";
import { parseContactExtractionPayload } from "../../../../lib/scout/api-validation";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

function unresolvedDomain(value: string | null | undefined) {
  return !value || value.endsWith(".invalid");
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseContactExtractionPayload>;
  try { payload = parseContactExtractionPayload(await request.json()); }
  catch { return Response.json({ error: "A valid job id is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [lead] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!lead) return Response.json({ error: "Internship lead not found" }, { status: 404 });
    if (lead.currentSnapshotId) return Response.json({ resolved: false, alreadyResolved: true, jobId: lead.id, jobSnapshotId: lead.currentSnapshotId });
    if (!lead.source.startsWith("lead:")) return Response.json({ error: "Only unresolved internship leads can be resolved" }, { status: 409 });

    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const resolveInput = { canonicalUrl: lead.canonicalUrl, company: lead.company, title: lead.title };
    const official = await client.resolveJob(resolveInput);

    const [registered] = await db.select().from(companySources).where(and(
      eq(companySources.provider, official.source.provider),
      eq(companySources.boardToken, official.source.boardToken),
    )).limit(1);
    if (registered && !registered.enabled) {
      return Response.json({ error: "Resolved official source is disabled" }, { status: 409 });
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
    if (!source?.enabled) return Response.json({ error: "Resolved official source is not enabled" }, { status: 409 });

    const observedAt = official.resolvedAt;
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
      }).where(and(eq(jobs.id, lead.id), isNull(jobs.currentSnapshotId))),
    ]);

    return Response.json({
      resolved: true,
      jobId: lead.id,
      jobSnapshotId: snapshotId,
      provider: official.source.provider,
      canonicalUrl: official.snapshot.canonicalUrl,
      companyDomain: unresolvedDomain(source.companyDomain) ? null : source.companyDomain,
      contactResearchReady: !unresolvedDomain(source.companyDomain),
    });
  } catch (error) {
    return scoutServerError("agent.resolve", error, "Cloud agent job resolution failed");
  }
}
