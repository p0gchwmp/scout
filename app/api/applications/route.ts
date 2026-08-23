import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { applications, candidateClaims, jobs, profileEvidence } from "../../../db/schema";
import { parseApplicationPreparePayload, PayloadValidationError } from "../../../lib/scout/api-validation";
import { buildApplicationPreparation } from "../../../lib/scout/application-prep";
import { evaluateResumeAlignment } from "../../../lib/scout/resume-alignment";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

async function readJson(request: Request) {
  try { return await request.json(); }
  catch { throw new PayloadValidationError("A JSON body is required"); }
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const db = getDb();
    const rows = await db.select().from(applications).orderBy(desc(applications.createdAt)).limit(100);
    const jobRows = rows.length ? await db.select().from(jobs).where(inArray(jobs.id, rows.map((row) => row.jobId))) : [];
    return Response.json({ applications: rows.map((row) => ({ ...row, job: jobRows.find((job) => job.id === row.jobId) ?? null })) });
  } catch (error) {
    return scoutServerError("applications.list", error, "Unable to load application queue");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  let payload: ReturnType<typeof parseApplicationPreparePayload>;
  try { payload = parseApplicationPreparePayload(await readJson(request)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid application preparation request" }, { status: 400 }); }
  try {
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    const [fields, claims] = await Promise.all([
      db.select().from(profileEvidence),
      db.select().from(candidateClaims),
    ]);
    const alignment = evaluateResumeAlignment(job, claims);
    const relevantClaimIds = alignment.supportingClaims.flatMap((support) => support.claimIds);
    const prepared = buildApplicationPreparation({ job, profileFields: fields, claims, relevantClaimIds });
    const [existing] = await db.select().from(applications).where(eq(applications.jobId, job.id)).limit(1);
    const values = {
      status: prepared.status,
      blockers: prepared.blockers,
      submittedFields: prepared.packet as unknown as Record<string, string>,
      artifactVersion: (existing?.artifactVersion ?? 0) + 1,
    };
    const [application] = existing
      ? await db.update(applications).set(values).where(eq(applications.id, existing.id)).returning()
      : await db.insert(applications).values({ id: crypto.randomUUID(), jobId: job.id, ...values }).returning();
    return Response.json({ application: { ...application, job } }, { status: existing ? 200 : 201 });
  } catch (error) {
    return scoutServerError("applications.prepare", error, "Unable to prepare application packet");
  }
}
