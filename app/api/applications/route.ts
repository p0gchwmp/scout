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

function refreshRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { action?: unknown; id?: unknown; expectedVersion?: unknown };
  if (raw.action !== "refresh") return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const expectedVersion = raw.expectedVersion;
  if (!id || id.length > 128 || !Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
    throw new PayloadValidationError("A valid application refresh id and expectedVersion are required");
  }
  return { id, expectedVersion: expectedVersion as number };
}

async function prepareJob(jobId: string, expectedApplication?: { id: string; expectedVersion: number }) {
  try {
    const db = getDb();
    if (expectedApplication) {
      const [current] = await db.select().from(applications).where(eq(applications.id, expectedApplication.id)).limit(1);
      if (!current) return Response.json({ error: "Application not found" }, { status: 404 });
      if (current.jobId !== jobId || current.artifactVersion !== expectedApplication.expectedVersion) {
        return Response.json({ error: "Application packet changed; reload and retry" }, { status: 409 });
      }
    }

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    const [fields, claims] = await Promise.all([
      db.select().from(profileEvidence),
      db.select().from(candidateClaims),
    ]);
    const alignment = evaluateResumeAlignment(job, claims);
    const relevantClaimIds = alignment.supportingClaims.flatMap((support) => support.claimIds);
    const prepared = buildApplicationPreparation({ job, profileFields: fields, claims, relevantClaimIds });
    const [existing] = await db.select().from(applications).where(eq(applications.jobId, job.id)).limit(1);
    if (expectedApplication && existing?.id !== expectedApplication.id) {
      return Response.json({ error: "Application packet changed; reload and retry" }, { status: 409 });
    }
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

  let raw: unknown;
  try { raw = await readJson(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid application preparation request" }, { status: 400 }); }

  try {
    const refresh = refreshRequest(raw);
    if (refresh) {
      const [current] = await getDb().select().from(applications).where(eq(applications.id, refresh.id)).limit(1);
      if (!current) return Response.json({ error: "Application not found" }, { status: 404 });
      return prepareJob(current.jobId, refresh);
    }
    const payload = parseApplicationPreparePayload(raw);
    return prepareJob(payload.jobId);
  } catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Invalid application preparation request" }, { status: 400 });
  }
}
