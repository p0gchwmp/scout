import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { jobs } from "../../../db/schema";
import { discoverControlledInternships } from "../../../lib/scout/lead-discovery";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  try {
    const discovery = await discoverControlledInternships();
    const db = getDb();
    let created = 0;
    let existing = 0;

    for (const lead of discovery.leads) {
      const [found] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.canonicalUrl, lead.canonicalUrl)).limit(1);
      if (found) {
        existing += 1;
        continue;
      }

      const now = new Date().toISOString();
      await db.insert(jobs).values({
        id: crypto.randomUUID(),
        source: `lead:discovery:${lead.provider}`,
        sourceRegistryId: null,
        externalId: crypto.randomUUID(),
        canonicalUrl: lead.canonicalUrl,
        company: lead.company,
        title: lead.title,
        description: "",
        location: lead.location,
        workplaceType: "unspecified",
        score: 0,
        scoreExplanation: [`Discovered from controlled public ${lead.provider} source; official posting snapshot still required`],
        eligibilityRisks: ["Official posting snapshot required before application preparation"],
        state: "saved",
        lifecycleState: "active",
        fingerprint: `lead|${lead.canonicalUrl}`,
        postedAt: lead.postedAt,
        firstSeenAt: now,
        lastSeenAt: now,
        missingCount: 0,
        currentSnapshotId: null,
      });
      created += 1;
    }

    return Response.json({
      found: discovery.leads.length,
      created,
      existing,
      failures: discovery.failures,
      leads: discovery.leads.map((lead) => ({
        canonicalUrl: lead.canonicalUrl,
        company: lead.company,
        title: lead.title,
        provider: lead.provider,
        sourceUrl: lead.sourceUrl,
        focus: lead.focus,
        location: lead.location,
        postedAt: lead.postedAt ?? null,
      })),
    });
  } catch (error) {
    return scoutServerError("lead-discovery.run", error, "Unable to discover internships");
  }
}
