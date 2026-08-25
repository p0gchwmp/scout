import { desc } from "drizzle-orm";
import discoveryCatalog from "../../../config/discovery-sources.json" with { type: "json" };
import { getDb } from "../../../db";
import { companySources, jobs, syncRuns } from "../../../db/schema";
import { assessSourceHealth, type SourceHealthRun } from "../../../lib/scout/source-health";
import { requireScoutApiUser, scoutServerError } from "../../scout-api";

function sourceKey(provider: string, boardToken: string) {
  return `${provider}:${boardToken}`;
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const db = getDb();
    const [registeredSources, recentRuns, jobRows] = await Promise.all([
      db.select({
        id: companySources.id,
        provider: companySources.provider,
        companyName: companySources.companyName,
        boardToken: companySources.boardToken,
        companyDomain: companySources.companyDomain,
        careersUrl: companySources.careersUrl,
        enabled: companySources.enabled,
        createdAt: companySources.createdAt,
      }).from(companySources).orderBy(companySources.companyName),
      db.select({
        id: syncRuns.id,
        sourceId: syncRuns.sourceId,
        idempotencyKey: syncRuns.idempotencyKey,
        status: syncRuns.status,
        observedAt: syncRuns.observedAt,
        discoveredCount: syncRuns.discoveredCount,
        createdCount: syncRuns.createdCount,
        updatedCount: syncRuns.updatedCount,
        unchangedCount: syncRuns.unchangedCount,
        closedCount: syncRuns.closedCount,
        completedAt: syncRuns.completedAt,
        error: syncRuns.error,
        createdAt: syncRuns.createdAt,
      }).from(syncRuns).orderBy(desc(syncRuns.observedAt), desc(syncRuns.createdAt)).limit(500),
      db.select({
        sourceId: jobs.sourceRegistryId,
        lifecycleState: jobs.lifecycleState,
        lastSeenAt: jobs.lastSeenAt,
      }).from(jobs),
    ]);

    const registeredByKey = new Map(registeredSources.map((source) => [sourceKey(source.provider, source.boardToken), source]));
    const latestRunBySource = new Map<string, (typeof recentRuns)[number]>();
    const lastSuccessfulAtBySource = new Map<string, string>();
    for (const run of recentRuns) {
      const current = latestRunBySource.get(run.sourceId);
      const preferSourceObservation = current?.observedAt === run.observedAt
        && run.idempotencyKey.startsWith("local-health:")
        && !current.idempotencyKey.startsWith("local-health:");
      if (!current || run.observedAt > current.observedAt || preferSourceObservation) latestRunBySource.set(run.sourceId, run);
      if (run.status === "completed" && !lastSuccessfulAtBySource.has(run.sourceId)) {
        lastSuccessfulAtBySource.set(run.sourceId, run.completedAt ?? run.observedAt);
      }
    }

    const jobStats = new Map<string, { active: number; total: number; lastSeenAt: string | null }>();
    for (const job of jobRows) {
      if (!job.sourceId) continue;
      const current = jobStats.get(job.sourceId) ?? { active: 0, total: 0, lastSeenAt: null };
      current.total += 1;
      if (job.lifecycleState === "active") current.active += 1;
      if (!current.lastSeenAt || Date.parse(job.lastSeenAt) > Date.parse(current.lastSeenAt)) current.lastSeenAt = job.lastSeenAt;
      jobStats.set(job.sourceId, current);
    }

    function healthFor(sourceId: string, enabled: boolean) {
      const latest = latestRunBySource.get(sourceId);
      const stats = jobStats.get(sourceId) ?? { active: 0, total: 0, lastSeenAt: null };
      const latestRun: SourceHealthRun | null = latest ? {
        status: latest.status,
        observedAt: latest.observedAt,
        completedAt: latest.completedAt,
        discoveredCount: latest.discoveredCount,
        createdCount: latest.createdCount,
        updatedCount: latest.updatedCount,
        unchangedCount: latest.unchangedCount,
        closedCount: latest.closedCount,
        error: latest.error,
      } : null;
      return {
        ...assessSourceHealth({
          enabled,
          latestRun,
          lastSuccessfulAt: lastSuccessfulAtBySource.get(sourceId) ?? null,
          activeJobs: stats.active,
          totalJobs: stats.total,
        }),
        lastJobSeenAt: stats.lastSeenAt,
      };
    }

    const catalogKeys = new Set(discoveryCatalog.map((source) => sourceKey(source.provider, source.slug)));
    const catalogSources = discoveryCatalog.map((catalogSource) => {
      const registered = registeredByKey.get(sourceKey(catalogSource.provider, catalogSource.slug));
      const id = registered?.id ?? `catalog-${catalogSource.provider}-${catalogSource.slug}`;
      return {
        id,
        provider: catalogSource.provider,
        boardToken: catalogSource.slug,
        companyName: catalogSource.company,
        companyDomain: catalogSource.companyDomain,
        careersUrl: registered?.careersUrl ?? catalogSource.sourceUrl,
        sourceUrl: catalogSource.sourceUrl,
        focus: catalogSource.focus,
        enabled: registered?.enabled ?? true,
        registered: Boolean(registered),
        catalogEntry: true,
        createdAt: registered?.createdAt ?? null,
        health: healthFor(id, registered?.enabled ?? true),
      };
    });

    const resolvedSources = registeredSources
      .filter((source) => !catalogKeys.has(sourceKey(source.provider, source.boardToken)))
      .map((source) => ({
        id: source.id,
        provider: source.provider,
        boardToken: source.boardToken,
        companyName: source.companyName,
        companyDomain: source.companyDomain,
        careersUrl: source.careersUrl,
        sourceUrl: source.careersUrl,
        focus: "Official source resolved by Scout",
        enabled: source.enabled,
        registered: true,
        catalogEntry: false,
        createdAt: source.createdAt,
        health: healthFor(source.id, source.enabled),
      }));

    const sources = [...catalogSources, ...resolvedSources].sort((left, right) => left.companyName.localeCompare(right.companyName));
    return Response.json({
      sources,
      summary: {
        catalog: catalogSources.length,
        registered: sources.filter((source) => source.registered).length,
        healthy: sources.filter((source) => source.health.state === "healthy").length,
        attention: sources.filter((source) => source.health.state === "degraded" || source.health.state === "needs_review").length,
      },
      recentRuns: recentRuns.slice(0, 50),
    });
  } catch (error) {
    return scoutServerError("sources.list", error, "Unable to load sources");
  }
}
