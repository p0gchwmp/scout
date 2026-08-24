import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { applications } from "../../../../../db/schema";
import { verifyBrowserHandoffToken } from "../../../../../lib/scout/browser-handoff";
import { buildBrowserAssistTask } from "../../../../../lib/scout/browser-task";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: corsHeaders });
}

function handoffSecret() {
  const bindings = env as unknown as Record<string, unknown>;
  const secret = typeof bindings.SCOUT_BROWSER_HANDOFF_SECRET === "string" ? bindings.SCOUT_BROWSER_HANDOFF_SECRET.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Browser handoff is not configured");
  return secret;
}

function payload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string" || record.token.length < 40 || record.token.length > 4000) throw new Error("Handoff token is invalid");
  if (typeof record.currentUrl !== "string" || record.currentUrl.length < 10 || record.currentUrl.length > 2000) throw new Error("Current application URL is invalid");
  if (Object.keys(record).some((key) => key !== "token" && key !== "currentUrl")) throw new Error("Unexpected browser handoff field");
  return { token: record.token, currentUrl: record.currentUrl };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  let input: ReturnType<typeof payload>;
  try { input = payload(await request.json()); }
  catch { return json({ error: "A valid handoff token and current application URL are required" }, 400); }

  try {
    const verified = await verifyBrowserHandoffToken({
      token: input.token,
      currentUrl: input.currentUrl,
      secret: handoffSecret(),
    });
    const db = getDb();
    const [application] = await db.select().from(applications).where(and(
      eq(applications.id, verified.applicationId),
      eq(applications.artifactVersion, verified.artifactVersion),
      eq(applications.status, "ready_for_review"),
    )).limit(1);
    if (!application) return json({ error: "The application packet changed or is no longer ready for review" }, 409);

    const task = buildBrowserAssistTask({
      applicationId: application.id,
      artifactVersion: application.artifactVersion,
      packet: application.submittedFields,
    });
    if (task.allowedUrl !== verified.allowedUrl) return json({ error: "The application URL changed after the handoff was minted" }, 409);

    return json({
      task,
      safety: {
        bearerTokenContainsProfileData: false,
        sensitiveQuestionsRequireReview: true,
        solveCaptcha: false,
        submitApplication: false,
      },
    });
  } catch {
    return json({ error: "Browser handoff was invalid, expired, or pinned to a different page" }, 401);
  }
}
