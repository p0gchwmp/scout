import type { CompanySource, JobRecord, JobSnapshotRecord, NormalizedJobSnapshot, SyncRun } from "./types";

const MISSING_RUNS_TO_CLOSE = 2;
const SUSPICIOUS_DROP_MINIMUM_ACTIVE = 4;
const SUSPICIOUS_DROP_RATIO = 0.5;

export type SyncDiscoveryResult = {
  jobs: NormalizedJobSnapshot[];
  complete: boolean;
};

export type SyncPlan = {
  jobs: JobRecord[];
  created: number;
  updated: number;
  unchanged: number;
  closed: number;
  discovered: number;
  reconciliationApplied: boolean;
};

export interface ScoutSyncStore {
  getSource(id: string): Promise<CompanySource | undefined>;
  findRun(sourceId: string, idempotencyKey: string): Promise<SyncRun | undefined>;
  createRun(run: SyncRun): Promise<SyncRun>;
  listJobs(sourceId: string): Promise<JobRecord[]>;
  persistPlan(run: SyncRun, plan: SyncPlan): Promise<SyncRun>;
  failRun(run: SyncRun, publicMessage: string): Promise<void>;
}

export type SyncOptions = {
  sourceId: string;
  idempotencyKey: string;
  observedAt: string;
  idFactory?: () => string;
};

export class SyncInProgressError extends Error {
  constructor() {
    super("A sync is already running for this source");
    this.name = "SyncInProgressError";
  }
}

function stableSnapshotJson(snapshot: NormalizedJobSnapshot) {
  return JSON.stringify({
    sourceProvider: snapshot.sourceProvider,
    externalId: snapshot.externalId,
    canonicalUrl: snapshot.canonicalUrl,
    company: snapshot.company,
    title: snapshot.title,
    description: snapshot.description,
    location: snapshot.location,
    workplaceType: snapshot.workplaceType,
    score: snapshot.score,
    scoreExplanation: snapshot.scoreExplanation,
    eligibilityRisks: snapshot.eligibilityRisks,
    postedAt: snapshot.postedAt ?? null,
  });
}

export async function snapshotHash(snapshot: NormalizedJobSnapshot) {
  const bytes = new TextEncoder().encode(stableSnapshotJson(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function shouldReconcileMissing(existingJobs: JobRecord[], discoveredCount: number, complete: boolean) {
  if (!complete) return false;
  const activeCount = existingJobs.filter((job) => job.lifecycleState === "active").length;
  if (activeCount === 0) return true;
  if (discoveredCount === 0) return false;
  if (activeCount >= SUSPICIOUS_DROP_MINIMUM_ACTIVE && discoveredCount < Math.ceil(activeCount * SUSPICIOUS_DROP_RATIO)) return false;
  return true;
}

export async function buildSyncPlan(
  existingJobs: JobRecord[],
  discovery: SyncDiscoveryResult,
  run: SyncRun,
  idFactory: () => string,
): Promise<SyncPlan> {
  const jobs = existingJobs.map((job) => ({
    ...job,
    currentSnapshot: { ...job.currentSnapshot },
    snapshots: job.snapshots.map((snapshot) => ({ ...snapshot })),
  }));
  const byExternalId = new Map(jobs.map((job) => [job.externalId, job]));
  const uniqueDiscovered = new Map(discovery.jobs.map((job) => [job.externalId, job]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const snapshot of uniqueDiscovered.values()) {
    const contentHash = await snapshotHash(snapshot);
    const existing = byExternalId.get(snapshot.externalId);
    if (!existing) {
      const jobId = idFactory();
      const record: JobSnapshotRecord = {
        ...snapshot,
        id: idFactory(),
        jobId,
        syncRunId: run.id,
        version: 1,
        contentHash,
        capturedAt: run.observedAt,
      };
      const job: JobRecord = {
        id: jobId,
        sourceId: run.sourceId,
        externalId: snapshot.externalId,
        lifecycleState: "active",
        firstSeenAt: run.observedAt,
        lastSeenAt: run.observedAt,
        closedAt: null,
        missingCount: 0,
        currentSnapshot: record,
        snapshots: [record],
      };
      jobs.push(job);
      byExternalId.set(job.externalId, job);
      created += 1;
      continue;
    }

    existing.lastSeenAt = run.observedAt;
    existing.lifecycleState = "active";
    existing.closedAt = null;
    existing.missingCount = 0;
    if (existing.currentSnapshot.contentHash === contentHash) {
      unchanged += 1;
      continue;
    }

    const priorSnapshot = existing.snapshots.find((candidate) => candidate.contentHash === contentHash);
    if (priorSnapshot) {
      existing.currentSnapshot = priorSnapshot;
      updated += 1;
      continue;
    }

    const record: JobSnapshotRecord = {
      ...snapshot,
      id: idFactory(),
      jobId: existing.id,
      syncRunId: run.id,
      version: Math.max(...existing.snapshots.map((item) => item.version), 0) + 1,
      contentHash,
      capturedAt: run.observedAt,
    };
    existing.currentSnapshot = record;
    existing.snapshots.push(record);
    updated += 1;
  }

  let closed = 0;
  const reconciliationApplied = shouldReconcileMissing(existingJobs, uniqueDiscovered.size, discovery.complete);
  if (reconciliationApplied) {
    for (const job of jobs) {
      if (uniqueDiscovered.has(job.externalId) || job.lifecycleState !== "active") continue;
      job.missingCount += 1;
      if (job.missingCount >= MISSING_RUNS_TO_CLOSE) {
        job.lifecycleState = "closed";
        job.closedAt = run.observedAt;
        closed += 1;
      }
    }
  }

  return {
    jobs,
    created,
    updated,
    unchanged,
    closed,
    discovered: uniqueDiscovered.size,
    reconciliationApplied,
  };
}

export async function synchronizeSource(
  store: ScoutSyncStore,
  discover: (source: CompanySource) => Promise<SyncDiscoveryResult>,
  options: SyncOptions,
): Promise<SyncRun> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(options.idempotencyKey)) throw new Error("Invalid idempotency key");
  const source = await store.getSource(options.sourceId);
  if (!source || !source.enabled) throw new Error("Enabled registered source not found");
  const prior = await store.findRun(source.id, options.idempotencyKey);
  if (prior) return prior;

  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const run: SyncRun = {
    id: idFactory(),
    sourceId: source.id,
    idempotencyKey: options.idempotencyKey,
    status: "running",
    observedAt: options.observedAt,
    discoveredCount: 0,
    createdCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    closedCount: 0,
    completedAt: null,
    error: null,
  };
  const createdRun = await store.createRun(run);
  if (createdRun.id !== run.id) return createdRun;

  try {
    const discovery = await discover(source);
    if (!discovery || !Array.isArray(discovery.jobs) || typeof discovery.complete !== "boolean") {
      throw new Error("Source discovery returned an invalid completeness envelope");
    }
    const plan = await buildSyncPlan(await store.listJobs(source.id), discovery, run, idFactory);
    return await store.persistPlan(run, plan);
  } catch (error) {
    await store.failRun(run, "Source sync failed");
    throw error;
  }
}
