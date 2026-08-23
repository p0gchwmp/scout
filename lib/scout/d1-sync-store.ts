import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { companySources, jobSnapshots, jobs, syncRuns } from "../../db/schema";
import { SyncInProgressError, type ScoutSyncStore, type SyncPlan } from "./sync";
import type { CompanySource, JobRecord, JobSnapshotRecord, SyncRun } from "./types";

type Database = ReturnType<typeof getDb>;
type D1Batch = Parameters<Database["batch"]>[0];

function mapSource(row: typeof companySources.$inferSelect): CompanySource {
  return {
    id: row.id,
    provider: row.provider,
    companyName: row.companyName,
    boardToken: row.boardToken,
    companyDomain: row.companyDomain,
    careersUrl: row.careersUrl,
    enabled: row.enabled,
  };
}

function mapRun(row: typeof syncRuns.$inferSelect): SyncRun {
  return {
    id: row.id,
    sourceId: row.sourceId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    observedAt: row.observedAt,
    discoveredCount: row.discoveredCount,
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    unchangedCount: row.unchangedCount,
    closedCount: row.closedCount,
    completedAt: row.completedAt,
    error: row.error,
  };
}

export class D1ScoutSyncStore implements ScoutSyncStore {
  constructor(private readonly db: Database = getDb()) {}

  async getSource(id: string) {
    const [row] = await this.db.select().from(companySources).where(eq(companySources.id, id)).limit(1);
    return row ? mapSource(row) : undefined;
  }

  async findRun(sourceId: string, idempotencyKey: string) {
    const [row] = await this.db.select().from(syncRuns).where(and(eq(syncRuns.sourceId, sourceId), eq(syncRuns.idempotencyKey, idempotencyKey))).limit(1);
    return row ? mapRun(row) : undefined;
  }

  async createRun(run: SyncRun) {
    try {
      await this.db.insert(syncRuns).values(run);
      return run;
    } catch (error) {
      const existing = await this.findRun(run.sourceId, run.idempotencyKey);
      if (existing) return existing;
      const [running] = await this.db.select({ id: syncRuns.id }).from(syncRuns)
        .where(and(eq(syncRuns.sourceId, run.sourceId), eq(syncRuns.status, "running")))
        .limit(1);
      if (running) throw new SyncInProgressError();
      throw error;
    }
  }

  async listJobs(sourceId: string): Promise<JobRecord[]> {
    const jobRows = await this.db.select().from(jobs).where(eq(jobs.sourceRegistryId, sourceId));
    if (!jobRows.length) return [];
    const snapshotRows = await this.db.select().from(jobSnapshots).where(inArray(jobSnapshots.jobId, jobRows.map((job) => job.id))).orderBy(asc(jobSnapshots.version));
    const grouped = new Map<string, JobSnapshotRecord[]>();
    for (const row of snapshotRows) {
      const job = jobRows.find((candidate) => candidate.id === row.jobId);
      if (!job) continue;
      const snapshot: JobSnapshotRecord = {
        id: row.id,
        jobId: row.jobId,
        syncRunId: row.syncRunId,
        version: row.version,
        contentHash: row.contentHash,
        capturedAt: row.capturedAt,
        sourceProvider: row.source as JobSnapshotRecord["sourceProvider"],
        externalId: job.externalId,
        canonicalUrl: row.canonicalUrl,
        company: row.company,
        title: row.title,
        description: row.description,
        location: row.location,
        workplaceType: row.workplaceType as JobSnapshotRecord["workplaceType"],
        score: row.score,
        scoreExplanation: row.scoreExplanation,
        eligibilityRisks: row.eligibilityRisks,
        postedAt: row.postedAt ?? undefined,
      };
      const values = grouped.get(row.jobId) ?? [];
      values.push(snapshot);
      grouped.set(row.jobId, values);
    }

    return jobRows.flatMap((row) => {
      const snapshots = grouped.get(row.id) ?? [];
      const currentSnapshot = snapshots.find((snapshot) => snapshot.id === row.currentSnapshotId);
      if (!currentSnapshot) return [];
      return [{
        id: row.id,
        sourceId,
        externalId: row.externalId,
        lifecycleState: row.lifecycleState,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        closedAt: row.closedAt,
        missingCount: row.missingCount,
        currentSnapshot,
        snapshots,
      }];
    });
  }

  async persistPlan(run: SyncRun, plan: SyncPlan) {
    const persisted = await this.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.sourceRegistryId, run.sourceId));
    const existingIds = new Set(persisted.map((row) => row.id));
    const statements: unknown[] = [];

    for (const job of plan.jobs) {
      const current = job.currentSnapshot;
      const values = {
        source: current.sourceProvider,
        sourceRegistryId: run.sourceId,
        externalId: job.externalId,
        canonicalUrl: current.canonicalUrl,
        company: current.company,
        title: current.title,
        description: current.description,
        location: current.location,
        workplaceType: current.workplaceType,
        score: current.score,
        scoreExplanation: current.scoreExplanation,
        eligibilityRisks: current.eligibilityRisks,
        lifecycleState: job.lifecycleState,
        fingerprint: `${run.sourceId}|${job.externalId}`,
        postedAt: current.postedAt,
        firstSeenAt: job.firstSeenAt,
        lastSeenAt: job.lastSeenAt,
        closedAt: job.closedAt,
        missingCount: job.missingCount,
        currentSnapshotId: current.id,
        ...(job.lastSeenAt === run.observedAt ? { lastSeenRunId: run.id } : {}),
      } as const;

      if (existingIds.has(job.id)) statements.push(this.db.update(jobs).set(values).where(eq(jobs.id, job.id)));
      else statements.push(this.db.insert(jobs).values({ id: job.id, ...values, state: "shortlisted" }));

      for (const snapshot of job.snapshots.filter((item) => item.syncRunId === run.id)) {
        statements.push(this.db.insert(jobSnapshots).values({
          id: snapshot.id,
          jobId: snapshot.jobId,
          syncRunId: snapshot.syncRunId,
          version: snapshot.version,
          contentHash: snapshot.contentHash,
          canonicalUrl: snapshot.canonicalUrl,
          company: snapshot.company,
          title: snapshot.title,
          description: snapshot.description,
          location: snapshot.location,
          workplaceType: snapshot.workplaceType,
          score: snapshot.score,
          scoreExplanation: snapshot.scoreExplanation,
          eligibilityRisks: snapshot.eligibilityRisks,
          postedAt: snapshot.postedAt,
          capturedAt: snapshot.capturedAt,
        }));
      }
    }

    const completedAt = new Date().toISOString();
    statements.push(this.db.update(syncRuns).set({
      status: "completed",
      discoveredCount: plan.discovered,
      createdCount: plan.created,
      updatedCount: plan.updated,
      unchangedCount: plan.unchanged,
      closedCount: plan.closed,
      completedAt,
      error: null,
    }).where(and(eq(syncRuns.id, run.id), eq(syncRuns.status, "running"))));

    await this.db.batch(statements as unknown as D1Batch);
    return {
      ...run,
      status: "completed" as const,
      discoveredCount: plan.discovered,
      createdCount: plan.created,
      updatedCount: plan.updated,
      unchangedCount: plan.unchanged,
      closedCount: plan.closed,
      completedAt,
      error: null,
    };
  }

  async failRun(run: SyncRun, publicMessage: string) {
    await this.db.update(syncRuns).set({
      status: "failed",
      completedAt: new Date().toISOString(),
      error: publicMessage.slice(0, 200),
    }).where(and(eq(syncRuns.id, run.id), eq(syncRuns.status, "running")));
  }
}
