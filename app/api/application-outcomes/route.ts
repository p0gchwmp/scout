import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { applications } from "../../../db/schema";
import {
  isApplicationOutcomeState,
  normalizeFollowUpAt,
  outcomeGuidance,
  validateOutcomeTransition,
} from "../../../lib/scout/application-outcomes";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

export const APPLICATION_OUTCOME_ROUTE_CAPABILITIES = Object.freeze({
  manualOutcomeUpdates: true,
  explicitFollowUpDate: true,
  sendEmail: false,
  readGmailThreads: false,
  submitApplication: false,
} as const);

type Mutation =
  | { action: "set_outcome"; applicationId: string; expectedArtifactVersion: number; outcome: string }
  | { action: "clear_outcome"; applicationId: string; expectedArtifactVersion: number }
  | { action: "set_follow_up"; applicationId: string; expectedArtifactVersion: number; followUpAt: string }
  | { action: "clear_follow_up"; applicationId: string; expectedArtifactVersion: number };

function parsePayload(value: unknown): Mutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const raw = value as Record<string, unknown>;
  const applicationId = typeof raw.applicationId === "string" ? raw.applicationId.trim() : "";
  const expectedArtifactVersion = raw.expectedArtifactVersion;
  if (!applicationId || applicationId.length > 160 || !Number.isInteger(expectedArtifactVersion) || Number(expectedArtifactVersion) < 1) {
    throw new Error("A valid applicationId and expectedArtifactVersion are required");
  }
  if (raw.action === "set_outcome") {
    if (!isApplicationOutcomeState(raw.outcome)) throw new Error("A valid application outcome is required");
    return { action: raw.action, applicationId, expectedArtifactVersion: Number(expectedArtifactVersion), outcome: raw.outcome };
  }
  if (raw.action === "clear_outcome") return { action: raw.action, applicationId, expectedArtifactVersion: Number(expectedArtifactVersion) };
  if (raw.action === "set_follow_up") {
    if (typeof raw.followUpAt !== "string") throw new Error("An explicit followUpAt timestamp is required");
    return { action: raw.action, applicationId, expectedArtifactVersion: Number(expectedArtifactVersion), followUpAt: raw.followUpAt };
  }
  if (raw.action === "clear_follow_up") return { action: raw.action, applicationId, expectedArtifactVersion: Number(expectedArtifactVersion) };
  throw new Error("Unsupported application outcome action");
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: Mutation;
  try { payload = parsePayload(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid application outcome request" }, { status: 400 }); }

  try {
    const db = getDb();
    const [current] = await db.select().from(applications).where(and(
      eq(applications.id, payload.applicationId),
      eq(applications.artifactVersion, payload.expectedArtifactVersion),
    )).limit(1);
    if (!current) return Response.json({ error: "Application tracking changed; reload and retry" }, { status: 409 });

    let status = current.status;
    let approvedAt = current.approvedAt;
    if (payload.action === "set_outcome") status = validateOutcomeTransition(current, payload.outcome);
    if (payload.action === "clear_outcome") {
      if (!current.submittedAt) return Response.json({ error: "No external submission is recorded" }, { status: 409 });
      status = "awaiting_reply";
    }
    if (payload.action === "set_follow_up") {
      if (!current.submittedAt) return Response.json({ error: "Record the external submission before setting a follow-up date" }, { status: 409 });
      approvedAt = normalizeFollowUpAt(payload.followUpAt);
    }
    if (payload.action === "clear_follow_up") approvedAt = null;

    const [application] = await db.update(applications).set({
      status,
      approvedAt,
      artifactVersion: current.artifactVersion + 1,
    }).where(and(
      eq(applications.id, current.id),
      eq(applications.artifactVersion, current.artifactVersion),
    )).returning();
    if (!application) return Response.json({ error: "Application tracking changed; reload and retry" }, { status: 409 });

    return Response.json({
      application,
      outcome: outcomeGuidance(application),
      externalSideEffect: false,
      sendEmail: false,
      submitApplication: false,
    });
  } catch (error) {
    return scoutServerError("application-outcomes.update", error, "Unable to update application outcome");
  }
}
