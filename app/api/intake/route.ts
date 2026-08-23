import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { jobs } from "../../../db/schema";
import { parseInternshipIntakePayload, PayloadValidationError } from "../../../lib/scout/api-validation";
import { normalizeInternshipLead } from "../../../lib/scout/job-intake";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new PayloadValidationError("A JSON body is required"); }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  try {
    const payload = parseInternshipIntakePayload(await readJson(request));
    const lead = normalizeInternshipLead(payload);
    const db = getDb();
    const [existing] = await db.select().from(jobs).where(eq(jobs.canonicalUrl, lead.canonicalUrl)).limit(1);
    if (existing) return Response.json({ job: existing, lead, created: false });

    const now = new Date().toISOString();
    const [job] = await db.insert(jobs).values({
      id: crypto.randomUUID(),
      source: `lead:${lead.channel.id}`,
      sourceRegistryId: null,
      externalId: crypto.randomUUID(),
      canonicalUrl: lead.canonicalUrl,
      company: lead.company,
      title: lead.title,
      description: "",
      location: "",
      workplaceType: "unspecified",
      score: 0,
      scoreExplanation: [`Lead captured from ${lead.channel.label}; official posting content has not been snapshotted`],
      eligibilityRisks: ["Official posting snapshot required before application preparation"],
      state: "saved",
      lifecycleState: "active",
      fingerprint: `lead|${lead.canonicalUrl}`,
      firstSeenAt: now,
      lastSeenAt: now,
      missingCount: 0,
      currentSnapshotId: null,
    }).returning();

    return Response.json({ job, lead, created: true }, { status: 201 });
  } catch (error) {
    if (error instanceof PayloadValidationError || error instanceof Error && /internship URL|Unsupported internship URL|private internship/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return scoutServerError("intake.create", error, "Unable to save internship lead");
  }
}
