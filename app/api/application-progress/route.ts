import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { applications } from "../../../db/schema";
import { parseApplicationProgressMutationPayload, PayloadValidationError } from "../../../lib/scout/api-validation";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

export const APPLICATION_PROGRESS_ROUTE_CAPABILITIES = Object.freeze({
  recordExternalSubmission: true,
  clearExternalSubmissionRecord: true,
  submitApplication: false,
  fetchEmployerPage: false,
} as const);

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseApplicationProgressMutationPayload>;
  try {
    payload = parseApplicationProgressMutationPayload(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof PayloadValidationError ? error.message : "Invalid application progress request" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [current] = await db.select().from(applications).where(and(
      eq(applications.id, payload.applicationId),
      eq(applications.artifactVersion, payload.expectedArtifactVersion),
    )).limit(1);
    if (!current) return Response.json({ error: "Application packet changed; reload before updating progress" }, { status: 409 });

    const values = payload.action === "mark_external_submission"
      ? {
        submittedAt: current.submittedAt ?? new Date().toISOString(),
        confirmationUrl: payload.confirmationUrl ?? current.confirmationUrl,
      }
      : { submittedAt: null, confirmationUrl: null };

    const [application] = await db.update(applications).set(values).where(and(
      eq(applications.id, current.id),
      eq(applications.artifactVersion, current.artifactVersion),
    )).returning();
    if (!application) return Response.json({ error: "Application progress changed; reload and retry" }, { status: 409 });

    return Response.json({
      application,
      recordOnly: true,
      externalSideEffect: false,
      submitApplication: false,
      message: payload.action === "mark_external_submission"
        ? "External submission recorded. Scout did not submit the application."
        : "External submission record cleared. No employer-side action was attempted.",
    });
  } catch (error) {
    return scoutServerError("application-progress.update", error, "Unable to update application progress");
  }
}
