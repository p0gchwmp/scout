import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { researchPublishedCompanyContacts } from "../../../agent/contact-research";
import { createAgentSearchProvider } from "../../../agent/search-runtime";
import { getDb } from "../../../db";
import { companyOutreachContacts, companyOutreachTargets } from "../../../db/company-outreach-schema";
import {
  ECOSYSTEM_ADJACENT_LANES,
  ECOSYSTEM_DISCOVERY_CAPABILITIES,
  ECOSYSTEM_SEARCH_QUERIES,
  ECOSYSTEM_SOURCES,
  assessEcosystemRecruitingContact,
  buildEcosystemOutreachSeeds,
  normalizeEcosystemSearchResult,
} from "../../../lib/scout/ecosystem-discovery";
import { createRunBudget, RUN_REQUEST_BUDGET_MS, RUN_RESPONSE_RESERVE_MS } from "../../../lib/scout/run-budget";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

type Action = "discover" | "seed_recruiting_targets" | "research_public_contacts";

const ECOSYSTEM_SEARCH_TIMEOUT_MS = 10_000;
const CONTACT_PAGE_TIMEOUT_MS = 2_500;
const CONTACT_MAX_PAGES_PER_TARGET = 5;
const MAX_RESEARCH_TARGETS = 3;
const RESEARCH_START_RESERVE_MS = 1_000;

function parseAction(value: unknown): Action {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const action = (value as Record<string, unknown>).action;
  if (action !== "discover" && action !== "seed_recruiting_targets" && action !== "research_public_contacts") {
    throw new Error("A supported ecosystem action is required");
  }
  return action;
}

function shortError(error: unknown) {
  return (error instanceof Error ? error.message : "Ecosystem research failed").replace(/\s+/g, " ").trim().slice(0, 160);
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  return Response.json({
    capabilities: ECOSYSTEM_DISCOVERY_CAPABILITIES,
    sources: ECOSYSTEM_SOURCES,
    adjacentLanes: ECOSYSTEM_ADJACENT_LANES,
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let action: Action;
  try { action = parseAction(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid ecosystem action" }, { status: 400 }); }

  const runBudget = createRunBudget();
  try {
    const db = getDb();
    if (action === "discover") {
      const provider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
      if (!provider) return Response.json({ enabled: false, leads: [], reason: "Scout search provider is disabled" });
      const timeoutMs = runBudget.boundedAgentTimeout(ECOSYSTEM_SEARCH_TIMEOUT_MS);
      if (!timeoutMs) {
        return Response.json({
          enabled: true,
          persistedSearchResults: false,
          curatedRegistryIsBootstrapNotAllowlist: true,
          queryLanes: [...new Set(ECOSYSTEM_SEARCH_QUERIES.map((query) => query.lane))],
          leads: [],
          failures: [{ queryId: "budget", reason: "Ecosystem discovery deferred to keep the hosted request bounded" }],
          partial: true,
          budget: { limitMs: RUN_REQUEST_BUDGET_MS, elapsedMs: runBudget.elapsedMs(), remainingMs: runBudget.remainingMs() },
          safety: { sendEmail: false, submitApplication: false, requiresHumanReview: true },
        });
      }
      const settled = await Promise.allSettled(ECOSYSTEM_SEARCH_QUERIES.map(async (query) => ({
        query,
        results: await provider.searchFixedQuery(query.query, { timeoutMs }),
      })));
      const leads = [];
      const failures: Array<{ queryId: string; reason: string }> = [];
      for (let index = 0; index < settled.length; index += 1) {
        const item = settled[index];
        const query = ECOSYSTEM_SEARCH_QUERIES[index];
        if (item.status === "rejected") {
          failures.push({ queryId: query.id, reason: "Search index temporarily unavailable" });
          continue;
        }
        for (const result of item.value.results) {
          const lead = normalizeEcosystemSearchResult(result, query);
          if (lead) leads.push({ ...lead, focus: query.focus });
        }
      }
      const deduped = [...new Map(leads.map((lead) => [lead.url, lead])).values()].slice(0, 60);
      return Response.json({
        enabled: true,
        persistedSearchResults: false,
        curatedRegistryIsBootstrapNotAllowlist: true,
        queryLanes: [...new Set(ECOSYSTEM_SEARCH_QUERIES.map((query) => query.lane))],
        leads: deduped,
        failures,
        partial: false,
        budget: { limitMs: RUN_REQUEST_BUDGET_MS, elapsedMs: runBudget.elapsedMs(), remainingMs: runBudget.remainingMs() },
        safety: { sendEmail: false, submitApplication: false, requiresHumanReview: true },
      });
    }

    if (action === "seed_recruiting_targets") {
      const existing = await db.select().from(companyOutreachTargets).where(eq(companyOutreachTargets.state, "active"));
      const seeds = buildEcosystemOutreachSeeds(existing.map((target) => target.companyDomain));
      const now = new Date().toISOString();
      const created = [];
      for (const seed of seeds) {
        const [target] = await db.insert(companyOutreachTargets).values({
          id: crypto.randomUUID(),
          companyName: seed.companyName,
          companyDomain: seed.companyDomain,
          officialUrl: seed.officialUrl,
          track: seed.track,
          interestNote: null,
          origin: seed.origin,
          researchFocus: seed.researchFocus,
          priorityScore: seed.priorityScore,
          state: "active",
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing().returning();
        if (target) created.push(target);
      }
      return Response.json({
        createdTargets: created.length,
        targets: created,
        budget: { limitMs: RUN_REQUEST_BUDGET_MS, elapsedMs: runBudget.elapsedMs(), remainingMs: runBudget.remainingMs() },
        safety: { sendEmail: false, submitApplication: false },
      }, { status: created.length ? 201 : 200 });
    }

    const [allTargets, existingContacts] = await Promise.all([
      db.select().from(companyOutreachTargets)
        .where(eq(companyOutreachTargets.state, "active"))
        .orderBy(asc(companyOutreachTargets.updatedAt), desc(companyOutreachTargets.priorityScore)),
      db.select({ targetId: companyOutreachContacts.targetId }).from(companyOutreachContacts),
    ]);
    const targetIdsWithContacts = new Set(existingContacts.map((contact) => contact.targetId));
    const eligibleTargets = allTargets
      .filter((target) => target.researchFocus?.startsWith("[ecosystem:"))
      .filter((target) => !targetIdsWithContacts.has(target.id));
    const targets = eligibleTargets.slice(0, MAX_RESEARCH_TARGETS);
    const searchProvider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
    let candidatesFound = 0;
    let candidatesStored = 0;
    let rejectedWrongPurpose = 0;
    let researchedTargets = 0;
    let deferredTargets = Math.max(0, eligibleTargets.length - targets.length);
    const failures: Array<{ targetId: string; reason: string }> = [];

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      if (!runBudget.canSpend(RESEARCH_START_RESERVE_MS)) {
        deferredTargets += targets.length - index;
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
        candidatesFound += research.candidates.length;
        for (const candidate of research.candidates) {
          const purpose = assessEcosystemRecruitingContact(candidate);
          if (!purpose.allowed) {
            rejectedWrongPurpose += 1;
            continue;
          }
          const [stored] = await db.insert(companyOutreachContacts).values({
            id: crypto.randomUUID(),
            targetId: target.id,
            email: candidate.email,
            sourceUrl: candidate.sourceUrl,
            excerpt: candidate.excerpt,
            sourceType: candidate.sourceType,
            sourceContext: candidate.sourceContext ?? "first_party",
            extractedAt: research.researchedAt,
            suitability: purpose.suitability === "high" ? "high" : "review",
            suitabilityReason: purpose.reason,
            reviewState: "needs_review",
          }).onConflictDoNothing().returning();
          if (stored) candidatesStored += 1;
        }
        if (research.deferredDueToTime) {
          deferredTargets += targets.length - index;
          break;
        }
      } catch (error) {
        failures.push({ targetId: target.id, reason: shortError(error) });
      } finally {
        await db.update(companyOutreachTargets).set({ updatedAt: new Date().toISOString() }).where(eq(companyOutreachTargets.id, target.id));
      }
    }
    return Response.json({
      researchedTargets,
      deferredTargets,
      candidatesFound,
      candidatesStored,
      rejectedWrongPurpose,
      failures,
      partial: deferredTargets > 0,
      contactsDefaultTo: "needs_review",
      budget: { limitMs: RUN_REQUEST_BUDGET_MS, elapsedMs: runBudget.elapsedMs(), remainingMs: runBudget.remainingMs() },
      safety: { sendEmail: false, submitApplication: false, guessEmails: false, scrapePersonalContacts: false },
    });
  } catch (error) {
    return scoutServerError("ecosystem", error, "Scout ecosystem discovery failed");
  }
}
