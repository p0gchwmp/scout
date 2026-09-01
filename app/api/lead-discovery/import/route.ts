import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companySources, jobSnapshots, jobs, syncRuns } from "../../../../db/schema";
import { localDiscoverySnapshot, verifyLocalDiscoveryEnvelope, type LocalBridgeLead, type LocalBridgeSourceObservation } from "../../../../lib/scout/local-discovery-import";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

type LocalSourceIdentity = Pick<LocalBridgeLead, "provider" | "slug" | "company" | "companyDomain" | "sourceUrl"> | LocalBridgeSourceObservation;

async function ensureRegisteredSource(db: ReturnType<typeof getDb>, source: LocalSourceIdentity) {
  const [registered] = await db.select().from(companySources).where(and(
    eq(companySources.provider, source.provider),
    eq(companySources.boardToken, source.slug),
  )).limit(1);
  if (registered) return registered;
  const sourceId = `catalog-${source.provider}-${source.slug}`;
  const [created] = await db.insert(companySources).values({
    id: sourceId,
    provider: source.provider,
    companyName: source.company,
    boardToken: source.slug,
    companyDomain: source.companyDomain,
    careersUrl: source.sourceUrl,
    enabled: true,
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [concurrent] = await db.select().from(companySources).where(and(
    eq(companySources.provider, source.provider),
    eq(companySources.boardToken, source.slug),
  )).limit(1);
  if (!concurrent) throw new Error(`Unable to register controlled ${source.provider} source`);
  return concurrent;
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  const runtime = (env as unknown as Record<string, unknown>).SCOUT_LOCAL_DEV_RUNTIME;
  const secret = (env as unknown as Record<string, unknown>).SCOUT_LOCAL_DISCOVERY_SECRET;
  if (runtime !== "1" || typeof secret !== "string") return Response.json({ error: "Local discovery import is unavailable" }, { status: 404 });

  try {
    const discovery = await verifyLocalDiscoveryEnvelope(await request.json(), secret);
    const db = getDb();
    let created = 0;
    let upgraded = 0;
    let existing = 0;

    for (const lead of discovery.leads) {
      const [byUrl] = await db.select().from(jobs).where(eq(jobs.canonicalUrl, lead.canonicalUrl)).limit(1);
      const official = await localDiscoverySnapshot(lead);
      const source = await ensureRegisteredSource(db, lead);

      const existingJob = byUrl ?? (await db.select().from(jobs).where(and(eq(jobs.sourceRegistryId, source.id), eq(jobs.externalId, lead.externalId))).limit(1))[0];
      if (existingJob?.currentSnapshotId) {
        existing += 1;
        continue;
      }

      const jobId = existingJob?.id ?? crypto.randomUUID();
      const runId = crypto.randomUUID();
      const snapshotId = crypto.randomUUID();
      const now = discovery.observedAt;
      const runKey = `local-bridge:${jobId}:${Date.parse(now)}`;
      const statements = [];
      statements.push(db.insert(syncRuns).values({
        id: runId, sourceId: source.id, idempotencyKey: runKey, status: "completed", observedAt: now,
        discoveredCount: 1, createdCount: existingJob ? 0 : 1, updatedCount: existingJob ? 1 : 0,
        unchangedCount: 0, closedCount: 0, completedAt: now, error: null,
      }));
      if (!existingJob) statements.push(db.insert(jobs).values({
        id: jobId, source: lead.provider, sourceRegistryId: source.id, externalId: lead.externalId,
        canonicalUrl: lead.canonicalUrl, company: lead.company, title: lead.title, description: lead.description,
        location: lead.location, workplaceType: lead.workplaceType, score: 0,
        scoreExplanation: official.snapshot.scoreExplanation, eligibilityRisks: official.snapshot.eligibilityRisks,
        state: "saved", lifecycleState: "active", fingerprint: `${source.id}|${lead.externalId}`,
        postedAt: lead.postedAt, firstSeenAt: now, lastSeenAt: now, missingCount: 0,
        currentSnapshotId: snapshotId, lastSeenRunId: runId,
      }));
      statements.push(db.insert(jobSnapshots).values({
        id: snapshotId, jobId, syncRunId: runId, version: 1, contentHash: official.contentHash,
        canonicalUrl: lead.canonicalUrl, company: lead.company, title: lead.title, description: lead.description,
        location: lead.location, workplaceType: lead.workplaceType, score: 0,
        scoreExplanation: official.snapshot.scoreExplanation, eligibilityRisks: official.snapshot.eligibilityRisks,
        postedAt: lead.postedAt, capturedAt: now,
      }));
      if (existingJob) statements.push(db.update(jobs).set({
        source: lead.provider, sourceRegistryId: source.id, externalId: lead.externalId, canonicalUrl: lead.canonicalUrl,
        company: lead.company, title: lead.title, description: lead.description, location: lead.location,
        workplaceType: lead.workplaceType, score: 0, scoreExplanation: official.snapshot.scoreExplanation,
        eligibilityRisks: official.snapshot.eligibilityRisks, postedAt: lead.postedAt,
        fingerprint: `${source.id}|${lead.externalId}`, currentSnapshotId: snapshotId, lastSeenRunId: runId, lastSeenAt: now,
      }).where(eq(jobs.id, existingJob.id)));
      await db.batch(statements as Parameters<typeof db.batch>[0]);
      if (existingJob) upgraded += 1;
      else created += 1;
    }

    let sourceChecks = 0;
    for (const observation of discovery.sources) {
      const source = await ensureRegisteredSource(db, observation);
      await db.insert(syncRuns).values({
        id: crypto.randomUUID(),
        sourceId: source.id,
        idempotencyKey: `local-health:${Date.parse(discovery.observedAt)}`,
        status: observation.status,
        observedAt: discovery.observedAt,
        discoveredCount: observation.internshipCount,
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        closedCount: 0,
        completedAt: discovery.observedAt,
        error: observation.reason,
        createdAt: discovery.observedAt,
      }).onConflictDoNothing();
      sourceChecks += 1;
    }

    return Response.json({
      found: discovery.leads.length, created, upgraded, existing, pending: 0, failures: discovery.failures, sourceChecks,
      leads: discovery.leads.map((lead) => ({
        canonicalUrl: lead.canonicalUrl, company: lead.company, title: lead.title, provider: lead.provider,
        sourceUrl: lead.sourceUrl, focus: lead.focus, location: lead.location, postedAt: lead.postedAt,
        description: lead.description, workplaceType: lead.workplaceType,
      })),
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error && /Discovery|discovery|Canonical|Greenhouse|Lever|Ashby|Workable|SmartRecruiters|stale|signature|controlled/i.test(error.message)) {
      const reason = error instanceof Error ? error.message : "Invalid local discovery import";
      console.warn("Scout local discovery import rejected", { reason });
      return Response.json({ error: reason }, { status: 400 });
    }
    return scoutServerError("lead-discovery.import", error, "Unable to import discovered internships");
  }
}
