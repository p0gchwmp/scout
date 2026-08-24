import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { contactEvidence, jobs } from "../../../../db/schema";
import { parseContactExtractionPayload } from "../../../../lib/scout/api-validation";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseContactExtractionPayload>;
  try { payload = parseContactExtractionPayload(await request.json()); }
  catch { return Response.json({ error: "A valid job id is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!job?.currentSnapshotId) return Response.json({ error: "Current immutable job snapshot is required" }, { status: 409 });

    const contacts = await db.select().from(contactEvidence).where(and(
      eq(contactEvidence.jobId, job.id),
      eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
      eq(contactEvidence.reviewState, "needs_review"),
    ));
    if (!contacts.length) return Response.json({ model: null, classified: 0, contacts: [] });

    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const result = await client.classifyContacts(contacts.map((contact) => ({
      id: contact.id,
      email: contact.email,
      sourceUrl: contact.sourceUrl,
      excerpt: contact.excerpt,
      sourceType: contact.sourceType,
    })));

    for (const classification of result.classifications) {
      const suitability = classification.suitability === "high" ? "high" : "review";
      const prefix = classification.suitability === "reject" ? "AI recommends reject: " : "AI: ";
      await db.update(contactEvidence).set({
        suitability,
        suitabilityReason: `${prefix}${classification.reason}`.slice(0, 1000),
      }).where(and(
        eq(contactEvidence.id, classification.candidateId),
        eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
        eq(contactEvidence.reviewState, "needs_review"),
      ));
    }

    const updated = await db.select().from(contactEvidence).where(and(
      eq(contactEvidence.jobId, job.id),
      eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
    ));
    return Response.json({ model: result.model, classified: result.classifications.length, contacts: updated });
  } catch (error) {
    return scoutServerError("agent.classify-contacts", error, "AI contact classification failed");
  }
}
