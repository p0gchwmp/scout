import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { applications } from "../../../../db/schema";
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
    )).limit(1);
    if (!application) return Response.json({ error: "Application packet must be ready for review before browser assistance" }, { status: 409 });

    const task = buildBrowserAssistTask({
      applicationId: application.id,
      artifactVersion: application.artifactVersion,
      packet: application.submittedFields,
    });
    return Response.json({ task, safety: { submitApplication: false, solveCaptcha: false } });
  } catch (error) {
    return scoutServerError("applications.browser-task", error, "Unable to create browser assistance task");
  }
}
