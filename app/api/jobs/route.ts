import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { jobs } from "../../../db/schema";
import { parseJobMutationPayload } from "../../../lib/scout/api-validation";
import { cleanJobText } from "../../../lib/scout/job-text";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

function presentJob<T extends { description: string }>(job: T): T {
  return { ...job, description: cleanJobText(job.description) } as T;
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const rows = await getDb().select().from(jobs).orderBy(desc(jobs.lastSeenAt), desc(jobs.score)).limit(100);
    return Response.json({ jobs: rows.map(presentJob) });
  } catch (error) {
    return scoutServerError("jobs.list", error, "Unable to load jobs");
  }
}

async function mutateJob(request: Request) {
  let payload: ReturnType<typeof parseJobMutationPayload>;
  try { payload = parseJobMutationPayload(await request.json()); }
  catch { return Response.json({ error: "A valid job mutation body is required" }, { status: 400 }); }
  try {
    const [job] = await getDb().update(jobs).set({ state: payload.state }).where(eq(jobs.id, payload.id)).returning();
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    return Response.json({ job: presentJob(job) });
  } catch (error) {
    return scoutServerError("jobs.update", error, "Unable to update job");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  return mutateJob(request);
}

// Dashboard compatibility: the current client posts Save/Reject mutations.
// Keep POST owner-authenticated and same-origin protected exactly like PATCH.
export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  return mutateJob(request);
}
