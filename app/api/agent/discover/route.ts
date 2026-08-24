import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { jobs } from "../../../../db/schema";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  try {
    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const discovery = await client.discoverInternships();
    const db = getDb();
    let created = 0;
    let existing = 0;

    for (const lead of discovery.leads) {
      const [found] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.canonicalUrl, lead.canonicalUrl)).limit(1);
      if (found) {
        existing += 1;
        continue;
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
        state: "saved",
        lifecycleState: "active",
        fingerprint: `agent-lead|${lead.canonicalUrl}`,
        postedAt: lead.postedAt,
        firstSeenAt: now,
        lastSeenAt: now,
        missingCount: 0,
        currentSnapshotId: null,
      });
      created += 1;
    }

    return Response.json({
      found: discovery.found,
      created,
      existing,
      observedAt: discovery.observedAt,
      failures: discovery.failures,
      leads: discovery.leads,
    });
  } catch (error) {
    return scoutServerError("agent.discovery", error, "Cloud agent discovery failed");
  }
}
