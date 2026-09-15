import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { applications, jobs, profileEvidence } from "../../../../db/schema";
import { applicationPacketProfileBindingIssues } from "../../../../lib/scout/application-profile-bindings";
import { applicationPacketMatchesCurrentSnapshot } from "../../../../lib/scout/application-review-packet";
import { createBrowserHandoffToken } from "../../../../lib/scout/browser-handoff";
import { resolveBrowserHandoffSecret } from "../../../../lib/scout/browser-handoff-runtime";
import { buildBrowserAssistTask } from "../../../../lib/scout/browser-task";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

function applicationId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const id = (value as Record<string, unknown>).applicationId;
  if (typeof id !== "string" || !/^[A-Za-z0-9._:-]{3,160}$/.test(id.trim())) throw new Error("A valid application id is required");
  return id.trim();
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let id: string;
  try { id = applicationId(await request.json()); }
  catch { return Response.json({ error: "A valid application id is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [application] = await db.select().from(applications).where(and(
      eq(applications.id, id),
      eq(applications.status, "ready_for_review"),
      isNull(applications.submittedAt),
    )).limit(1);
    if (!application) return Response.json({ error: "Application packet must be ready, current, and not already recorded as submitted before browser assistance" }, { status: 409 });
    const [jobRows, currentProfileFields] = await Promise.all([
      db.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1),
      db.select().from(profileEvidence),
    ]);
    const job = jobRows[0];
    if (!job?.currentSnapshotId || !applicationPacketMatchesCurrentSnapshot(application.submittedFields, job.currentSnapshotId)) {
      return Response.json({ error: "Application packet is stale because the job snapshot changed; refresh the packet before browser assistance" }, { status: 409 });
    }
    const profileIssues = applicationPacketProfileBindingIssues(application.submittedFields, currentProfileFields);
    if (profileIssues.length) {
      return Response.json({ error: "Application packet is stale because verified profile evidence changed; refresh the packet before browser assistance", profileIssues }, { status: 409 });
    }

    const task = buildBrowserAssistTask({
      applicationId: application.id,
      artifactVersion: application.artifactVersion,
      packet: application.submittedFields,
    });
    const handoff = await createBrowserHandoffToken({
      applicationId: task.applicationId,
      artifactVersion: task.artifactVersion,
      allowedUrl: task.allowedUrl,
      secret: resolveBrowserHandoffSecret(env as unknown as Record<string, unknown>),
    });
    return Response.json({
      task,
      handoffToken: handoff.token,
      handoffExpiresAt: handoff.expiresAt,
      safety: { profileDataInToken: false, submitApplication: false, solveCaptcha: false },
    });
  } catch (error) {
    return scoutServerError("applications.browser-task", error, "Unable to create browser assistance task");
  }
}
