import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { researchPublishedCompanyContacts } from "../../../../agent/contact-research";
import { createAgentSearchProvider } from "../../../../agent/search-runtime";
import { getDb } from "../../../../db";
import { companyOutreachContacts, companyOutreachTargets } from "../../../../db/company-outreach-schema";
import { assessPublishedContact, rankPublishedContacts } from "../../../../lib/scout/contact-intelligence";
import { parseTargetIdPayload } from "../../../../lib/scout/company-outreach";
import { createRunBudget, RUN_REQUEST_BUDGET_MS, RUN_RESPONSE_RESERVE_MS } from "../../../../lib/scout/run-budget";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const CONTACT_MAX_PAGES = 8;
const CONTACT_PAGE_TIMEOUT_MS = 3_000;

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let targetId: string;
  try { ({ targetId } = parseTargetIdPayload(await request.json())); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "A valid target id is required" }, { status: 400 }); }

  const runBudget = createRunBudget();
  try {
    const db = getDb();
    const [target] = await db.select().from(companyOutreachTargets).where(eq(companyOutreachTargets.id, targetId)).limit(1);
    if (!target || target.state !== "active") return Response.json({ error: "Active company outreach target not found" }, { status: 404 });

    const searchProvider = createAgentSearchProvider(env as unknown as NodeJS.ProcessEnv);
    const deadlineAt = Date.now() + Math.max(0, runBudget.remainingMs() - RUN_RESPONSE_RESERVE_MS);
    const research = await researchPublishedCompanyContacts({
      companyName: target.companyName,
      companyDomain: target.companyDomain,
      jobSnapshotId: `company-target:${target.id}`,
      careersUrl: target.officialUrl,
      searchProvider,
      deadlineAt,
      maxPages: CONTACT_MAX_PAGES,
      pageTimeoutMs: CONTACT_PAGE_TIMEOUT_MS,
    });

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

    await db.update(companyOutreachTargets).set({ updatedAt: new Date().toISOString() }).where(eq(companyOutreachTargets.id, target.id));
    const stored = await db.select().from(companyOutreachContacts).where(eq(companyOutreachContacts.targetId, target.id));
    return Response.json({
      target,
      pagesAttempted: research.pagesAttempted,
      firstPartyPagesAttempted: research.firstPartyPagesAttempted,
      publicPagesAttempted: research.publicPagesAttempted,
      searchQueriesAttempted: research.searchQueriesAttempted,
      searchProvider: searchProvider?.provider ?? null,
      candidatesFound: research.candidates.length,
      deferredDueToTime: research.deferredDueToTime,
      partial: research.deferredDueToTime,
      failures: research.failures,
      contacts: rankPublishedContacts(stored),
      budget: {
        limitMs: RUN_REQUEST_BUDGET_MS,
        elapsedMs: runBudget.elapsedMs(),
        remainingMs: runBudget.remainingMs(),
      },
    });
  } catch (error) {
    return scoutServerError("company-outreach.research", error, "Company-first contact research failed");
  }
}
