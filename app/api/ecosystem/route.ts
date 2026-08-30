import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
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
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

type Action = "discover" | "seed_recruiting_targets" | "research_public_contacts";

function parseAction(value: unknown): Action {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const action = (value as Record<string, unknown>).action;
  if (action !== "discover" && action !== "seed_recruiting_targets" && action !== "research_public_contacts") {
    throw new Error("A supported ecosystem action is required");
  }
  return action;
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

  try {
    const db = getDb();
    if (action === "discover") {
      const provider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
      if (!provider) return Response.json({ enabled: false, leads: [], reason: "Scout search provider is disabled" });
      const settled = await Promise.allSettled(ECOSYSTEM_SEARCH_QUERIES.map(async (query) => ({
        query,
        results: await provider.searchFixedQuery(query.query),
      })));
      const leads = [];
      const failures = [];
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
      return Response.json({ createdTargets: created.length, targets: created, safety: { sendEmail: false, submitApplication: false } }, { status: created.length ? 201 : 200 });
    }

    const targets = (await db.select().from(companyOutreachTargets)
      .where(eq(companyOutreachTargets.state, "active"))
      .orderBy(desc(companyOutreachTargets.priorityScore)))
      .filter((target) => target.researchFocus?.startsWith("[ecosystem:"))
      .slice(0, 3);
    const searchProvider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
    let candidatesFound = 0;
    let candidatesStored = 0;
    let rejectedWrongPurpose = 0;
    for (const target of targets) {
      const research = await researchPublishedCompanyContacts({
        companyName: target.companyName,
        companyDomain: target.companyDomain,
        jobSnapshotId: `company-target:${target.id}`,
        careersUrl: target.officialUrl,
        searchProvider,
      });
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
    }
    return Response.json({
      researchedTargets: targets.length,
      candidatesFound,
      candidatesStored,
      rejectedWrongPurpose,
      contactsDefaultTo: "needs_review",
      safety: { sendEmail: false, submitApplication: false, guessEmails: false, scrapePersonalContacts: false },
    });
  } catch (error) {
    return scoutServerError("ecosystem", error, "Scout ecosystem discovery failed");
  }
}
