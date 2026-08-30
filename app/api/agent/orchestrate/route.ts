import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { researchPublishedCompanyContacts } from "../../../../agent/contact-research";
import { createAgentSearchProvider } from "../../../../agent/search-runtime";
import { getDb } from "../../../../db";
import { companyOutreachContacts, companyOutreachTargets } from "../../../../db/company-outreach-schema";
import { applications, contactEvidence, outreachDrafts } from "../../../../db/schema";
import {
  ECOSYSTEM_SEARCH_QUERIES,
  assessEcosystemRecruitingContact,
  buildEcosystemOutreachSeeds,
  normalizeEcosystemSearchResult,
} from "../../../../lib/scout/ecosystem-discovery";
import {
  ONE_RUN_ORCHESTRATION_CAPABILITIES,
  dedupeEphemeralLeads,
  summarizeOutcomeQueue,
} from "../../../../lib/scout/one-run-orchestration";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";
import { POST as runCoreScout } from "../run/route";

const MAX_ECOSYSTEM_CONTACT_RESEARCH = 3;

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

function shortError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown failure").replace(/\s+/g, " ").trim().slice(0, 180);
}

async function discoverEcosystem() {
  const provider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
  if (!provider) return { enabled: false, leads: [], failures: [], queryLanes: [], reason: "Scout search provider is disabled" };

  const settled = await Promise.allSettled(ECOSYSTEM_SEARCH_QUERIES.map(async (query) => ({
    query,
    results: await provider.searchFixedQuery(query.query),
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
  };
}

async function runCuratedEcosystemContactResearch() {
  const db = getDb();
  const existing = await db.select().from(companyOutreachTargets).where(eq(companyOutreachTargets.state, "active"));
  const seeds = buildEcosystemOutreachSeeds(existing.map((target) => target.companyDomain));
  const now = new Date().toISOString();
  let createdTargets = 0;

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
    if (target) createdTargets += 1;
  }

  const targets = (await db.select().from(companyOutreachTargets)
    .where(eq(companyOutreachTargets.state, "active"))
    .orderBy(desc(companyOutreachTargets.priorityScore)))
    .filter((target) => target.researchFocus?.startsWith("[ecosystem:"));
  const searchProvider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
  let researchedTargets = 0;
  let candidatesFound = 0;
  let candidatesStored = 0;
  let rejectedWrongPurpose = 0;
  const failures: Array<{ targetId: string; reason: string }> = [];

  for (const target of targets) {
    const currentContacts = await db.select().from(companyOutreachContacts).where(eq(companyOutreachContacts.targetId, target.id));
    if (currentContacts.length) continue;
    if (researchedTargets >= MAX_ECOSYSTEM_CONTACT_RESEARCH) break;
    try {
      const research = await researchPublishedCompanyContacts({
        companyName: target.companyName,
        companyDomain: target.companyDomain,
        jobSnapshotId: `company-target:${target.id}`,
        careersUrl: target.officialUrl,
        searchProvider,
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
    } catch (error) {
      failures.push({ targetId: target.id, reason: shortError(error) });
    }
  }

  return { createdTargets, researchedTargets, candidatesFound, candidatesStored, rejectedWrongPurpose, failures };
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  try {
    const coreResponse = await runCoreScout(request);
    const corePayload = await coreResponse.json() as CoreRunPayload;
    if (!coreResponse.ok || !corePayload.run) {
      return Response.json(corePayload, { status: coreResponse.status });
    }

    const [ecosystem, ecosystemResearch] = await Promise.all([
      discoverEcosystem(),
      runCuratedEcosystemContactResearch(),
    ]);

    const db = getDb();
    const [applicationRows, jobContacts, drafts, ecosystemContacts] = await Promise.all([
      db.select().from(applications),
      db.select().from(contactEvidence),
      db.select().from(outreachDrafts),
      db.select().from(companyOutreachContacts),
    ]);
    const outcomes = summarizeOutcomeQueue(applicationRows);
    const draftedJobs = new Set(drafts.map((draft) => draft.jobId));
    const acceptedReadyForDraft = new Set(jobContacts
      .filter((contact) => contact.reviewState === "accepted" && !draftedJobs.has(contact.jobId))
      .map((contact) => contact.jobId)).size;
    const ecosystemContactsNeedReview = ecosystemContacts.filter((contact) => contact.reviewState === "needs_review").length;

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
          reason: "Accepted contacts are surfaced for a reviewed drafting decision; one-run does not spend AI drafting capacity or create Gmail drafts automatically.",
        },
        outcomes,
        reviewQueue: {
          ...(corePayload.run.reviewQueue ?? {}),
          ecosystemContactsNeedReview,
          followUpsDue: outcomes.followUpsDue,
          acceptedContactsReadyForDraft: acceptedReadyForDraft,
          ecosystemLeadsToTriage: ecosystem.leads.length,
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
