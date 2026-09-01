import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { jobs } from "../../../db/schema";
import { normalizeExternalLead } from "../../../lib/scout/external-lead";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: "A JSON external lead body is required" }, { status: 400 }); }

  let lead: ReturnType<typeof normalizeExternalLead>;
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("External lead body is invalid");
    lead = normalizeExternalLead(raw as Record<string, unknown> as Parameters<typeof normalizeExternalLead>[0]);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "External lead is invalid" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [existing] = await db.select().from(jobs).where(eq(jobs.canonicalUrl, lead.resolutionCandidateUrl)).limit(1);
    if (existing) return Response.json({ job: existing, externalLead: lead, created: false });

    const now = new Date().toISOString();
    const [job] = await db.insert(jobs).values({
      id: crypto.randomUUID(),
      source: "lead:external:sprout",
      sourceRegistryId: null,
      externalId: crypto.randomUUID(),
      canonicalUrl: lead.resolutionCandidateUrl,
      company: lead.company,
      title: lead.title,
      description: "",
      location: "",
      workplaceType: "unspecified",
      score: 0,
      scoreExplanation: [
        `Lead captured manually from Sprout: ${lead.leadUrl}`,
        "Sprout context is not employer evidence; resolve an official employer/ATS posting before application preparation",
      ],
      eligibilityRisks: ["Official posting snapshot required before application preparation"],
      state: "saved",
      lifecycleState: "active",
      fingerprint: `external-sprout|${lead.leadUrl}`,
      firstSeenAt: now,
      lastSeenAt: now,
      missingCount: 0,
      currentSnapshotId: null,
    }).returning();
    return Response.json({ job, externalLead: lead, created: true }, { status: 201 });
  } catch (error) {
    return scoutServerError("external-leads.create", error, "Unable to save external lead");
  }
}
