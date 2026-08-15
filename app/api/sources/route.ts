import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { companySources, syncRuns } from "../../../db/schema";
import { requireScoutApiUser, scoutServerError } from "../../scout-api";

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const db = getDb();
    const sources = await db.select({
      id: companySources.id,
      provider: companySources.provider,
      companyName: companySources.companyName,
      companyDomain: companySources.companyDomain,
      careersUrl: companySources.careersUrl,
      enabled: companySources.enabled,
      createdAt: companySources.createdAt,
    }).from(companySources).orderBy(companySources.companyName);
    const recentRuns = await db.select({
      id: syncRuns.id,
      sourceId: syncRuns.sourceId,
      status: syncRuns.status,
      observedAt: syncRuns.observedAt,
      discoveredCount: syncRuns.discoveredCount,
      createdCount: syncRuns.createdCount,
      updatedCount: syncRuns.updatedCount,
      unchangedCount: syncRuns.unchangedCount,
      closedCount: syncRuns.closedCount,
      completedAt: syncRuns.completedAt,
      createdAt: syncRuns.createdAt,
    }).from(syncRuns).orderBy(desc(syncRuns.createdAt)).limit(20);
    return Response.json({ sources, recentRuns });
  } catch (error) {
    return scoutServerError("sources.list", error, "Unable to load sources");
  }
}
