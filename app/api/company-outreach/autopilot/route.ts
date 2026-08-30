import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { researchPublishedCompanyContacts } from "../../../../agent/contact-research";
import { createAgentSearchProvider } from "../../../../agent/search-runtime";
import { getDb } from "../../../../db";
import { companySources, jobs } from "../../../../db/schema";
import { companyOutreachContacts, companyOutreachTargets } from "../../../../db/company-outreach-schema";
import { buildCompanyAutopilotQueue } from "../../../../lib/scout/company-autopilot";
import { assessPublishedContact } from "../../../../lib/scout/contact-intelligence";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const MAX_TARGETS_PER_RUN = 12;
const MAX_RESEARCH_TARGETS_PER_RUN = 4;

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  try {
    const db = getDb();
    const [sources, activeJobs, existingTargets] = await Promise.all([
      db.select().from(companySources).where(eq(companySources.enabled, true)),
      db.select().from(jobs).where(eq(jobs.lifecycleState, "active")).orderBy(desc(jobs.score)).limit(300),
      db.select().from(companyOutreachTargets).where(eq(companyOutreachTargets.state, "active")),
    ]);

    const queue = buildCompanyAutopilotQueue({
      sources,
      jobs: activeJobs,
      existingDomains: existingTargets.map((target) => target.companyDomain),
      limit: MAX_TARGETS_PER_RUN,
    });
    const now = new Date().toISOString();
    const createdTargets = [];
    for (const candidate of queue) {
      const [created] = await db.insert(companyOutreachTargets).values({
        id: crypto.randomUUID(),
        companyName: candidate.companyName,
        companyDomain: candidate.companyDomain,
        officialUrl: candidate.officialUrl,
        track: candidate.track,
        interestNote: null,
        origin: candidate.origin,
        researchFocus: candidate.researchFocus,
        priorityScore: candidate.priorityScore,
        state: "active",
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning();
      if (created) createdTargets.push(created);
    }

    const allTargets = await db.select().from(companyOutreachTargets)
      .where(eq(companyOutreachTargets.state, "active"))
      .orderBy(desc(companyOutreachTargets.priorityScore), desc(companyOutreachTargets.createdAt))
      .limit(100);
    const searchProvider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
    const researchTargets = allTargets.slice(0, MAX_RESEARCH_TARGETS_PER_RUN);
    let pagesAttempted = 0;
    let searchQueriesAttempted = 0;
    let candidatesFound = 0;

    for (const target of researchTargets) {
      const research = await researchPublishedCompanyContacts({
        companyName: target.companyName,
        companyDomain: target.companyDomain,
        jobSnapshotId: `company-target:${target.id}`,
        careersUrl: target.officialUrl,
        searchProvider,
      });
      pagesAttempted += research.pagesAttempted;
      searchQueriesAttempted += research.searchQueriesAttempted;
      candidatesFound += research.candidates.length;
      for (const candidate of research.candidates) {
        const intelligence = assessPublishedContact(candidate);
        await db.insert(companyOutreachContacts).values({
          id: crypto.randomUUID(),
          targetId: target.id,
          email: candidate.email,
          sourceUrl: candidate.sourceUrl,
          excerpt: candidate.excerpt,
          sourceType: candidate.sourceType,
          sourceContext: candidate.sourceContext ?? "first_party",
          extractedAt: research.researchedAt,
          suitability: "review",
          suitabilityReason: `Deterministic recruiting relevance ${intelligence.score}/100: ${intelligence.reasons.join("; ")}. Human review is required.`,
          reviewState: "needs_review",
        }).onConflictDoNothing();
      }
    }

    return Response.json({
      createdTargets: createdTargets.length,
      queuedTargets: allTargets.length,
      researchedTargets: researchTargets.length,
      pagesAttempted,
      searchQueriesAttempted,
      candidatesFound,
      searchProvider: searchProvider?.provider ?? null,
      targets: allTargets.slice(0, 20),
    });
  } catch (error) {
    return scoutServerError("company-outreach.autopilot", error, "Scout outreach autopilot failed");
  }
}
