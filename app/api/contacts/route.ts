import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { companySources, contactEvidence, jobSnapshots, jobs } from "../../../db/schema";
import { parseContactExtractionPayload, parseContactReviewPayload } from "../../../lib/scout/api-validation";
import { extractPublishedBusinessEmails } from "../../../lib/scout/contact-extraction";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const contacts = await getDb().select().from(contactEvidence).orderBy(desc(contactEvidence.extractedAt)).limit(100);
    return Response.json({ contacts });
  } catch (error) {
    return scoutServerError("contacts.list", error, "Unable to load contacts");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  let payload: ReturnType<typeof parseContactExtractionPayload>;
  try { payload = parseContactExtractionPayload(await request.json()); }
  catch { return Response.json({ error: "A valid contact extraction body is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!job || !job.sourceRegistryId || !job.currentSnapshotId) return Response.json({ error: "Synced job snapshot not found" }, { status: 404 });
    const [source] = await db.select().from(companySources).where(eq(companySources.id, job.sourceRegistryId)).limit(1);
    const [snapshot] = await db.select().from(jobSnapshots).where(and(eq(jobSnapshots.id, job.currentSnapshotId), eq(jobSnapshots.jobId, job.id))).limit(1);
    if (!source || !source.enabled || !snapshot) return Response.json({ error: "Enabled source and current job snapshot are required" }, { status: 409 });

    const result = extractPublishedBusinessEmails({
      persistedContent: snapshot.description,
      evidenceUrl: snapshot.canonicalUrl,
      boardToken: source.boardToken,
      externalId: job.externalId,
      companyDomain: source.companyDomain,
      provider: source.provider,
    });
    if (result.contacts.length) {
      await db.batch(result.contacts.map((contact) => db.insert(contactEvidence).values({
        id: crypto.randomUUID(),
        jobId: job.id,
        jobSnapshotId: snapshot.id,
        ...contact,
      }).onConflictDoNothing()) as [ReturnType<typeof db.insert>, ...ReturnType<typeof db.insert>[]]);
    }
    const contacts = await db.select().from(contactEvidence).where(eq(contactEvidence.jobSnapshotId, snapshot.id)).orderBy(contactEvidence.reviewState, contactEvidence.email);
    return Response.json({ contacts, rejections: result.rejections });
  } catch (error) {
    return scoutServerError("contacts.extract", error, "Contact extraction failed");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  let payload: ReturnType<typeof parseContactReviewPayload>;
  try { payload = parseContactReviewPayload(await request.json()); }
  catch { return Response.json({ error: "A valid contact review body is required" }, { status: 400 }); }
  try {
    const [contact] = await getDb().update(contactEvidence)
      .set({ reviewState: payload.reviewState })
      .where(eq(contactEvidence.id, payload.id))
      .returning();
    if (!contact) return Response.json({ error: "Contact evidence not found" }, { status: 404 });
    return Response.json({ contact });
  } catch (error) {
    return scoutServerError("contacts.review", error, "Unable to review contact evidence");
  }
}
