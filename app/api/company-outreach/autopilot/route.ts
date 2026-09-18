import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { researchPublishedCompanyContacts } from "../../../../agent/contact-research";
import { createAgentSearchProvider } from "../../../../agent/search-runtime";
import { getDb } from "../../../../db";
import { companySources, jobs } from "../../../../db/schema";
import { companyOutreachContacts, companyOutreachTargets } from "../../../../db/company-outreach-schema";
import { buildCompanyAutopilotQueue } from "../../../../lib/scout/company-autopilot";
import { assessPublishedContact } from "../../../../lib/scout/contact-intelligence";
import { createRunBudget, RUN_REQUEST_BUDGET_MS, RUN_RESPONSE_RESERVE_MS } from "../../../../lib/scout/run-budget";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const MAX_TARGETS_PER_RUN = 60;
const MAX_RESEARCH_TARGETS_PER_RUN = 4;
const CONTACT_MAX_PAGES_PER_TARGET = 6;
const CONTACT_PAGE_TIMEOUT_MS = 3_000;
const RESEARCH_START_RESERVE_MS = 1_000;

function shortError(error: unknown) {
  return (error instanceof Error ? error.message : "Company research failed").replace(/\s+/g, " ").trim().slice(0, 160);
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  const runBudget = createRunBudget();

  try {
    const db = getDb();
    const [sources, activeJobs, existingTargets] = await Promise.all([
      db.select().from(companySources).where(eq(companySources.enabled, true)),
      db.select().from(jobs).where(eq(jobs.lifecycleState, "active")).orderBy(desc(jobs.score)).limit(1000),
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

    const [allTargets, existingContacts] = await Promise.all([
      db.select().from(companyOutreachTargets)
        .where(eq(companyOutreachTargets.state, "active"))
        .orderBy(asc(companyOutreachTargets.updatedAt), desc(companyOutreachTargets.priorityScore), desc(companyOutreachTargets.createdAt))
        .limit(250),
      db.select({ targetId: companyOutreachContacts.targetId }).from(companyOutreachContacts),
    ]);
    const targetIdsWithContacts = new Set(existingContacts.map((contact) => contact.targetId));
    const eligibleTargets = allTargets.filter((target) => !targetIdsWithContacts.has(target.id));
    const researchTargets = eligibleTargets.slice(0, MAX_RESEARCH_TARGETS_PER_RUN);
    const searchProvider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);

    let pagesAttempted = 0;
    let searchQueriesAttempted = 0;
    let candidatesFound = 0;
    let researchedTargets = 0;
    let deferredTargets = Math.max(0, eligibleTargets.length - researchTargets.length);
    const failures: Array<{ targetId: string; reason: string }> = [];

    for (let index = 0; index < researchTargets.length; index += 1) {
      const target = researchTargets[index];
      if (!runBudget.canSpend(RESEARCH_START_RESERVE_MS)) {
        deferredTargets += researchTargets.length - index;
        break;
      }

      const deadlineAt = Date.now() + Math.max(0, runBudget.remainingMs() - RUN_RESPONSE_RESERVE_MS);
      try {
        const research = await researchPublishedCompanyContacts({
          companyName: target.companyName,
          companyDomain: target.companyDomain,
          jobSnapshotId: `company-target:${target.id}`,
          careersUrl: target.officialUrl,
          searchProvider,
          deadlineAt,
          maxPages: CONTACT_MAX_PAGES_PER_TARGET,
          pageTimeoutMs: CONTACT_PAGE_TIMEOUT_MS,
        });
        researchedTargets += 1;
        pagesAttempted += research.pagesAttempted;
        searchQueriesAttempted += research.searchQueriesAttempted;
        candidatesFound += research.candidates.length;

        if (research.candidates.length) {
          await db.batch(research.candidates.map((candidate) => {
            const intelligence = assessPublishedContact(candidate);
            return db.insert(companyOutreachContacts).values({
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
          }) as [ReturnType<typeof db.insert>, ...ReturnType<typeof db.insert>[]]);
        }

        if (research.deferredDueToTime) {
          deferredTargets += researchTargets.length - index;
          break;
        }
      } catch (error) {
        failures.push({ targetId: target.id, reason: shortError(error) });
      } finally {
        await db.update(companyOutreachTargets).set({ updatedAt: new Date().toISOString() }).where(eq(companyOutreachTargets.id, target.id));
      }
    }

    return Response.json({
      createdTargets: createdTargets.length,
      queuedTargets: allTargets.length,
      researchedTargets,
      deferredTargets,
      pagesAttempted,
      searchQueriesAttempted,
      candidatesFound,
      searchProvider: searchProvider?.provider ?? null,
      failures,
      partial: deferredTargets > 0,
      budget: {
        limitMs: RUN_REQUEST_BUDGET_MS,
        elapsedMs: runBudget.elapsedMs(),
        remainingMs: runBudget.remainingMs(),
      },
      targets: allTargets,
    });
  } catch (error) {
    return scoutServerError("company-outreach.autopilot", error, "Scout outreach autopilot failed");
  }
}
