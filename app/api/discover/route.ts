import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { jobs } from "../../../db/schema";
import { GreenhouseAdapter, LeverAdapter } from "../../../lib/adapters";
import { isEligibleForDailyQueue, rankJob } from "../../../lib/ranking";
import type { CandidateProfile } from "../../../lib/types";

const adapters = { greenhouse: new GreenhouseAdapter(), lever: new LeverAdapter() };
const defaultProfile: CandidateProfile = {
  roleKeywords: ["product", "business", "operations", "strategy", "analyst"],
  verifiedSkills: ["research", "analytics", "excel", "sql", "communication"],
  preferredLocations: ["india", "bengaluru", "mumbai", "delhi", "hyderabad", "pune"],
  currentStudent: true,
  remoteAllowed: true,
  workAuthorizedCountries: ["IN"],
};

export async function POST(request: Request) {
  const payload = await request.json() as { source?: keyof typeof adapters; companyToken?: string; profile?: CandidateProfile };
  if (!payload.source || !adapters[payload.source]) return Response.json({ error: "Unsupported source" }, { status: 400 });
  if (!payload.companyToken || !/^[a-zA-Z0-9_-]{2,80}$/.test(payload.companyToken)) return Response.json({ error: "Invalid company token" }, { status: 400 });

  try {
    const discovered = await adapters[payload.source].discover(payload.companyToken);
    const ranked = discovered.map((job) => rankJob(job, payload.profile ?? defaultProfile)).filter(isEligibleForDailyQueue);
    const db = getDb();
    for (const job of ranked) {
      const fingerprint = `${job.company}|${job.title}|${job.location}`.toLowerCase().replace(/\s+/g, " ");
      const existing = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.source, job.source), eq(jobs.externalId, job.externalId))).limit(1);
      if (existing.length) continue;
      await db.insert(jobs).values({
        id: crypto.randomUUID(), source: job.source, externalId: job.externalId, canonicalUrl: job.canonicalUrl,
        company: job.company, title: job.title, description: job.description, location: job.location,
        workplaceType: job.workplaceType, score: job.score, scoreExplanation: job.reasons,
        eligibilityRisks: job.risks, state: "shortlisted", fingerprint, postedAt: job.postedAt,
      }).onConflictDoNothing();
    }
    return Response.json({ discovered: discovered.length, shortlisted: ranked.length, jobs: ranked.slice(0, 10) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Discovery failed" }, { status: 502 });
  }
}
