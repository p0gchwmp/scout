import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { applications, jobs } from "../../../db/schema";

const allowedStates = new Set(["discovered", "shortlisted", "approved", "filling", "needs_input", "submitted", "failed", "withdrawn", "saved", "rejected"]);

export async function GET() {
  try {
    const rows = await getDb().select().from(jobs).orderBy(desc(jobs.score), desc(jobs.lastSeenAt)).limit(50);
    return Response.json({ jobs: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load jobs" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const payload = await request.json() as { id?: string; state?: string };
  if (!payload.id || !payload.state || !allowedStates.has(payload.state)) return Response.json({ error: "Valid id and state are required" }, { status: 400 });
  const db = getDb();
  const [job] = await db.update(jobs).set({ state: payload.state }).where(eq(jobs.id, payload.id)).returning();
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  if (payload.state === "approved") {
    await db.insert(applications).values({ id: crypto.randomUUID(), jobId: job.id, status: "approved", approvedAt: new Date().toISOString() }).onConflictDoUpdate({ target: applications.jobId, set: { status: "approved", approvedAt: new Date().toISOString() } });
  }
  return Response.json({ job });
}
