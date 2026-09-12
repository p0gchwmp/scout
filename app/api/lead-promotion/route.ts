import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { createAgentSearchProvider } from "../../../agent/search-runtime";
import { resolveSearchLeadToOfficialAts } from "../../../agent/official-resolution";
import { getDb } from "../../../db";
import { companySources, jobSnapshots, jobs, syncRuns } from "../../../db/schema";
import { leadPromotionIdempotencyKey, parseLeadPromotionPayload } from "../../../lib/scout/lead-promotion";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

async function ensureVerifiedAtsSource(db: ReturnType<typeof getDb>, resolved: Awaited<ReturnType<typeof resolveSearchLeadToOfficialAts>>) {
  const [existing] = await db.select().from(companySources).where(and(
    eq(companySources.provider, resolved.source.provider),
    eq(companySources.boardToken, resolved.source.boardToken),
  )).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(companySources).values({
    id: resolved.source.id,
    provider: resolved.source.provider,
    companyName: resolved.source.companyName,
    boardToken: resolved.source.boardToken,
    companyDomain: resolved.source.companyDomain,
    careersUrl: resolved.source.careersUrl,
    enabled: true,
  }).onConflictDoNothing().returning();
  if (created) return created;

  const [concurrent] = await db.select().from(companySources).where(and(
    eq(companySources.provider, resolved.source.provider),
    eq(companySources.boardToken, resolved.source.boardToken),
  )).limit(1);
  if (!concurrent) throw new Error("Verified ATS source could not be registered");
  return concurrent;
}

async function persistResolvedLead(resolved: Awaited<ReturnType<typeof resolveSearchLeadToOfficialAts>>) {
  const db = getDb();
  const source = await ensureVerifiedAtsSource(db, resolved);
  const [byUrl] = await db.select().from(jobs).where(eq(jobs.canonicalUrl, resolved.snapshot.canonicalUrl)).limit(1);
  const [byExternal] = await db.select().from(jobs).where(and(
    eq(jobs.sourceRegistryId, source.id),
    eq(jobs.externalId, resolved.snapshot.externalId),
  )).limit(1);
  const existingJob = byUrl ?? byExternal ?? null;

  if (existingJob) {
    const [sameSnapshot] = await db.select().from(jobSnapshots).where(and(
      eq(jobSnapshots.jobId, existingJob.id),
      eq(jobSnapshots.contentHash, resolved.contentHash),
    )).limit(1);
    if (sameSnapshot) {
      if (existingJob.currentSnapshotId !== sameSnapshot.id) {
        throw new Error("Official posting matches an older immutable snapshot; refresh the registered source before reusing historical evidence");
      }
      return { job: existingJob, snapshot: sameSnapshot, source, created: false, refreshed: false, reused: true };
    }
  }

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const jobId = existingJob?.id ?? crypto.randomUUID();
  const [latestSnapshot] = existingJob
    ? await db.select().from(jobSnapshots).where(eq(jobSnapshots.jobId, existingJob.id)).orderBy(desc(jobSnapshots.version)).limit(1)
    : [];
  const version = (latestSnapshot?.version ?? 0) + 1;
  const idempotencyKey = leadPromotionIdempotencyKey(resolved.snapshot.externalId, resolved.contentHash);

  const statements: Parameters<typeof db.batch>[0][number][] = [];
  statements.push(db.insert(syncRuns).values({
    id: runId,
    sourceId: source.id,
    idempotencyKey,
    status: "completed",
    observedAt: now,
    discoveredCount: 1,
    createdCount: existingJob ? 0 : 1,
    updatedCount: existingJob ? 1 : 0,
    unchangedCount: 0,
    closedCount: 0,
    completedAt: now,
    error: null,
  }));

  if (!existingJob) {
    statements.push(db.insert(jobs).values({
      id: jobId,
      source: resolved.source.provider,
      sourceRegistryId: source.id,
      externalId: resolved.snapshot.externalId,
      canonicalUrl: resolved.snapshot.canonicalUrl,
      company: resolved.snapshot.company,
      title: resolved.snapshot.title,
      description: resolved.snapshot.description,
      location: resolved.snapshot.location,
      workplaceType: resolved.snapshot.workplaceType,
      score: resolved.snapshot.score,
      scoreExplanation: resolved.snapshot.scoreExplanation,
      eligibilityRisks: resolved.snapshot.eligibilityRisks,
      state: "shortlisted",
      lifecycleState: "active",
      fingerprint: `${source.id}|${resolved.snapshot.externalId}`,
      postedAt: resolved.snapshot.postedAt,
      firstSeenAt: now,
      lastSeenAt: now,
      missingCount: 0,
      currentSnapshotId: snapshotId,
      lastSeenRunId: runId,
    }));
  }

  statements.push(db.insert(jobSnapshots).values({
    id: snapshotId,
    jobId,
    syncRunId: runId,
    version,
    contentHash: resolved.contentHash,
    canonicalUrl: resolved.snapshot.canonicalUrl,
    company: resolved.snapshot.company,
    title: resolved.snapshot.title,
    description: resolved.snapshot.description,
    location: resolved.snapshot.location,
    workplaceType: resolved.snapshot.workplaceType,
    score: resolved.snapshot.score,
    scoreExplanation: resolved.snapshot.scoreExplanation,
    eligibilityRisks: resolved.snapshot.eligibilityRisks,
    postedAt: resolved.snapshot.postedAt,
    capturedAt: now,
  }));

  if (existingJob) {
    statements.push(db.update(jobs).set({
      source: resolved.source.provider,
      sourceRegistryId: source.id,
      externalId: resolved.snapshot.externalId,
      canonicalUrl: resolved.snapshot.canonicalUrl,
      company: resolved.snapshot.company,
      title: resolved.snapshot.title,
      description: resolved.snapshot.description,
      location: resolved.snapshot.location,
      workplaceType: resolved.snapshot.workplaceType,
      score: resolved.snapshot.score,
      scoreExplanation: resolved.snapshot.scoreExplanation,
      eligibilityRisks: resolved.snapshot.eligibilityRisks,
      postedAt: resolved.snapshot.postedAt,
      lifecycleState: "active",
      closedAt: null,
      missingCount: 0,
      fingerprint: `${source.id}|${resolved.snapshot.externalId}`,
      currentSnapshotId: snapshotId,
      lastSeenRunId: runId,
      lastSeenAt: now,
    }).where(eq(jobs.id, existingJob.id)));
  }

  await db.batch(statements as Parameters<typeof db.batch>[0]);
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const [snapshot] = await db.select().from(jobSnapshots).where(eq(jobSnapshots.id, snapshotId)).limit(1);
  if (!job || !snapshot) throw new Error("Official role promotion did not persist completely");
  return { job, snapshot, source, created: !existingJob, refreshed: Boolean(existingJob), reused: false };
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseLeadPromotionPayload>;
  try { payload = parseLeadPromotionPayload(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid lead-promotion request" }, { status: 400 }); }

  try {
    const searchProvider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
    if (!searchProvider) return Response.json({ error: "Official-source web search is disabled" }, { status: 409 });

    const resolved = await resolveSearchLeadToOfficialAts({
      leadUrl: payload.leadUrl,
      company: payload.companyHint,
      title: payload.title,
    }, { searchProvider });
    const promoted = await persistResolvedLead(resolved);

    return Response.json({
      promotion: {
        jobId: promoted.job.id,
        snapshotId: promoted.snapshot.id,
        sourceId: promoted.source.id,
        provider: promoted.source.provider,
        canonicalUrl: promoted.snapshot.canonicalUrl,
        company: promoted.snapshot.company,
        title: promoted.snapshot.title,
        created: promoted.created,
        refreshed: promoted.refreshed,
        reused: promoted.reused,
      },
      evidence: {
        officialAtsRefetched: true,
        searchSnippetPersisted: false,
        originalLeadPersisted: false,
        companyDomainResolved: resolved.resolutionEvidence.companyDomainResolved,
      },
      safety: {
        unknownEcosystemSourceAutoTrusted: false,
        contactAccepted: false,
        gmailDraftCreated: false,
        sendEmail: false,
        submitApplication: false,
      },
    }, { status: promoted.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && /No sufficiently matched official|Official-source web search|Employer\/company|Role title|HTTPS lead URL|older immutable snapshot/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return scoutServerError("lead-promotion", error, "Unable to resolve this lead to verified official job evidence");
  }
}
