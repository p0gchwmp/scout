import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { jobs } from "../../../../db/schema";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { createRunBudget, RUN_REQUEST_BUDGET_MS } from "../../../../lib/scout/run-budget";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const DISCOVERY_TIMEOUT_MS = 15_000;
const DB_STEP_RESERVE_MS = 750;

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  const runBudget = createRunBudget();

  try {
    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const discoveryTimeoutMs = runBudget.boundedAgentTimeout(DISCOVERY_TIMEOUT_MS);
    if (!discoveryTimeoutMs) throw new Error("Scout discovery time budget was exhausted before discovery");

    const discovery = await client.discoverInternships({ timeoutMs: discoveryTimeoutMs });
    const db = getDb();
    const knownCanonicalUrls = new Set(
      (await db.select({ canonicalUrl: jobs.canonicalUrl }).from(jobs)).map((job) => job.canonicalUrl),
    );
    let created = 0;
    let existing = 0;
    let persistenceDeferred = 0;

    for (let index = 0; index < discovery.leads.length; index += 1) {
      const lead = discovery.leads[index];
      if (knownCanonicalUrls.has(lead.canonicalUrl)) {
        existing += 1;
        continue;
      }

      if (!runBudget.canSpend(DB_STEP_RESERVE_MS)) {
        const deferredCanonicalUrls = new Set<string>();
        for (const remaining of discovery.leads.slice(index)) {
          if (!knownCanonicalUrls.has(remaining.canonicalUrl)) deferredCanonicalUrls.add(remaining.canonicalUrl);
        }
        persistenceDeferred = deferredCanonicalUrls.size;
        break;
      }

      const now = discovery.observedAt || new Date().toISOString();
      await db.insert(jobs).values({
        id: crypto.randomUUID(),
        source: `lead:agent:${lead.provider}`,
        sourceRegistryId: null,
        externalId: crypto.randomUUID(),
        canonicalUrl: lead.canonicalUrl,
        company: lead.company,
        title: lead.title,
        description: "",
        location: lead.location,
        workplaceType: "unspecified",
        score: 0,
        scoreExplanation: [`Discovered by signed Scout cloud agent from controlled public ${lead.provider} source`],
        eligibilityRisks: ["Official immutable posting snapshot required before application preparation"],
        state: "shortlisted",
        lifecycleState: "active",
        fingerprint: `agent-lead|${lead.canonicalUrl}`,
        postedAt: lead.postedAt,
        firstSeenAt: now,
        lastSeenAt: now,
        missingCount: 0,
        currentSnapshotId: null,
      });
      knownCanonicalUrls.add(lead.canonicalUrl);
      created += 1;
    }

    return Response.json({
      found: discovery.found,
      created,
      existing,
      persistenceDeferred,
      observedAt: discovery.observedAt,
      failures: discovery.failures,
      leads: discovery.leads,
      budgetMs: {
        limit: RUN_REQUEST_BUDGET_MS,
        elapsed: runBudget.elapsedMs(),
        remaining: runBudget.remainingMs(),
      },
    });
  } catch (error) {
    return scoutServerError("agent.discovery", error, "Cloud agent discovery failed");
  }
}
