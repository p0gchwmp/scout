import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createAgentSearchProvider } from "../../../../agent/search-runtime";
import { getDb } from "../../../../db";
import { companyOutreachContacts, companyOutreachTargets } from "../../../../db/company-outreach-schema";
import { applications, contactEvidence, outreachDrafts } from "../../../../db/schema";
import {
  ECOSYSTEM_SEARCH_QUERIES,
  buildEcosystemOutreachSeeds,
  normalizeEcosystemSearchResult,
} from "../../../../lib/scout/ecosystem-discovery";
import {
  ONE_RUN_ORCHESTRATION_CAPABILITIES,
  dedupeEphemeralLeads,
  summarizeOutcomeQueue,
} from "../../../../lib/scout/one-run-orchestration";
import { createRunBudget, RUN_REQUEST_BUDGET_MS } from "../../../../lib/scout/run-budget";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";
import { POST as runCoreScout } from "../run/route";

const ECOSYSTEM_SEARCH_TIMEOUT_MS = 10_000;
const SUMMARY_DB_RESERVE_MS = 750;

type CoreRunPayload = {
  run?: {
    reviewQueue?: {
      applicationsReady?: number;
      applicationsNeedInput?: number;
      contactsNeedReview?: number;
    };
    safety?: Record<string, boolean>;
    [key: string]: unknown;
  };
  error?: string;
};

type RunBudget = ReturnType<typeof createRunBudget>;

async function discoverEcosystem(runBudget: RunBudget) {
  const provider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
  if (!provider) return { enabled: false, leads: [], failures: [], queryLanes: [], reason: "Scout search provider is disabled", partial: false };

  const timeoutMs = runBudget.boundedAgentTimeout(ECOSYSTEM_SEARCH_TIMEOUT_MS);
  if (!timeoutMs) {
    return {
      enabled: true,
      persistedSearchResults: false,
      queryLanes: [...new Set(ECOSYSTEM_SEARCH_QUERIES.map((query) => query.lane))],
      leads: [],
      failures: [{ queryId: "budget", reason: "Ecosystem search deferred to keep the hosted request bounded" }],
      partial: true,
    };
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
  return {
    enabled: true,
    persistedSearchResults: false,
    queryLanes: [...new Set(ECOSYSTEM_SEARCH_QUERIES.map((query) => query.lane))],
    leads: dedupeEphemeralLeads(leads),
    failures,
    partial: false,
  };
}

async function seedCuratedEcosystemTargets(runBudget: RunBudget) {
  if (!runBudget.canSpend(SUMMARY_DB_RESERVE_MS)) {
    return {
      createdTargets: 0,
      researchedTargets: 0,
      candidatesFound: 0,
      candidatesStored: 0,
      rejectedWrongPurpose: 0,
      deferredTargets: 0,
      deferredToDedicatedResearch: true,
      reason: "Curated target seeding was deferred because the one-run request reached its hosted response reserve.",
      failures: [] as Array<{ targetId: string; reason: string }>,
    };
  }

  const db = getDb();
  const existing = await db.select().from(companyOutreachTargets).where(eq(companyOutreachTargets.state, "active"));
  const seeds = buildEcosystemOutreachSeeds(existing.map((target) => target.companyDomain));
  const now = new Date().toISOString();
  let createdTargets = 0;

  for (const seed of seeds) {
    if (!runBudget.canSpend(SUMMARY_DB_RESERVE_MS)) break;
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
    if (target) createdTargets += 1;
  }

  const [targets, contacts] = await Promise.all([
    db.select().from(companyOutreachTargets).where(eq(companyOutreachTargets.state, "active")),
    db.select({ targetId: companyOutreachContacts.targetId }).from(companyOutreachContacts),
  ]);
  const targetIdsWithContacts = new Set(contacts.map((contact) => contact.targetId));
  const deferredTargets = targets.filter((target) => target.researchFocus?.startsWith("[ecosystem:") && !targetIdsWithContacts.has(target.id)).length;

  return {
    createdTargets,
    researchedTargets: 0,
    candidatesFound: 0,
    candidatesStored: 0,
    rejectedWrongPurpose: 0,
    deferredTargets,
    deferredToDedicatedResearch: true,
    reason: "Long public-contact crawling is intentionally deferred to the bounded ecosystem/company research routes instead of being stacked after the core Scout run.",
    failures: [] as Array<{ targetId: string; reason: string }>,
  };
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  const runBudget = createRunBudget();

  try {
    // Start the bounded, ephemeral ecosystem search alongside the already-bounded
    // core run. Do not wait for the core run and then start another long network stage.
    const ecosystemPromise = discoverEcosystem(runBudget);
    const coreResponse = await runCoreScout(request);
    const ecosystem = await ecosystemPromise;
    const corePayload = await coreResponse.json() as CoreRunPayload;
    if (!coreResponse.ok || !corePayload.run) {
      return Response.json(corePayload, { status: coreResponse.status });
    }

    const ecosystemResearch = await seedCuratedEcosystemTargets(runBudget);
    let outcomes = summarizeOutcomeQueue([]);
    let acceptedReadyForDraft = 0;
    let ecosystemContactsNeedReview = 0;
    let summaryDeferredDueToTime = false;

    if (runBudget.canSpend(SUMMARY_DB_RESERVE_MS)) {
      const db = getDb();
      const [applicationRows, jobContacts, drafts, ecosystemContacts] = await Promise.all([
        db.select().from(applications),
        db.select().from(contactEvidence),
        db.select().from(outreachDrafts),
        db.select().from(companyOutreachContacts),
      ]);
      outcomes = summarizeOutcomeQueue(applicationRows);
      const draftedJobs = new Set(drafts.map((draft) => draft.jobId));
      acceptedReadyForDraft = new Set(jobContacts
        .filter((contact) => contact.reviewState === "accepted" && !draftedJobs.has(contact.jobId))
        .map((contact) => contact.jobId)).size;
      ecosystemContactsNeedReview = ecosystemContacts.filter((contact) => contact.reviewState === "needs_review").length;
    } else {
      summaryDeferredDueToTime = true;
    }

    return Response.json({
      run: {
        ...corePayload.run,
        ecosystem: {
          ...ecosystem,
          directInstitutionLeads: ecosystem.leads.filter((lead) => lead.sourceMode === "direct_institution").length,
          portfolioLeads: ecosystem.leads.filter((lead) => lead.sourceMode === "portfolio_board").length,
          sourceReviewLeads: ecosystem.leads.filter((lead) => lead.requiresOfficialSourceRegistration).length,
          curatedContactResearch: ecosystemResearch,
        },
        outreachPreparation: {
          acceptedContactsReadyForDraft: acceptedReadyForDraft,
          autoDrafted: 0,
          summaryDeferredDueToTime,
          reason: summaryDeferredDueToTime
            ? "The hosted response reserve was reached; open Review for current accepted-contact counts. No drafting action was taken."
            : "Accepted contacts are surfaced for a reviewed drafting decision; one-run does not spend AI drafting capacity or create Gmail drafts automatically.",
        },
        outcomes,
        reviewQueue: {
          ...(corePayload.run.reviewQueue ?? {}),
          ecosystemContactsNeedReview,
          followUpsDue: outcomes.followUpsDue,
          acceptedContactsReadyForDraft,
          ecosystemLeadsToTriage: ecosystem.leads.length,
        },
        orchestrationBudget: {
          limitMs: RUN_REQUEST_BUDGET_MS,
          elapsedMs: runBudget.elapsedMs(),
          remainingMs: runBudget.remainingMs(),
          summaryDeferredDueToTime,
        },
        capabilities: ONE_RUN_ORCHESTRATION_CAPABILITIES,
        safety: {
          ...(corePayload.run.safety ?? {}),
          autoPromotePortfolioLead: false,
          autoAcceptContact: false,
          createGmailDraft: false,
          sendEmail: false,
          submitApplication: false,
        },
      },
    });
  } catch (error) {
    return scoutServerError("agent.orchestrate", error, "One-run Scout orchestration failed");
  }
}
