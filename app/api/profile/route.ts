import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { profileEvidence } from "../../../db/schema";
import { parseProfileReviewPayload, parseProfileUpsertPayload, PayloadValidationError } from "../../../lib/scout/api-validation";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

async function readJson(request: Request) {
  try { return await request.json(); }
  catch { throw new PayloadValidationError("A JSON body is required"); }
}

function expectedUpdatedAt(value: unknown) {
  if (typeof value !== "string") throw new PayloadValidationError("Profile expectedUpdatedAt is required");
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || /[\r\n\0]/.test(value)) {
    throw new PayloadValidationError("Profile expectedUpdatedAt is invalid");
  }
  return normalized;
}

function profileRecordId(kind: string) {
  return `profile:${kind}`;
}

function dashboardReviewPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { id?: unknown; action?: unknown; verified?: unknown; expectedUpdatedAt?: unknown };
  if (raw.action !== "verify" && raw.action !== "unverify") return null;
  const action = typeof raw.verified === "boolean"
    ? (raw.verified ? "verify" : "unverify")
    : raw.action;
  return { id: raw.id, action, expectedUpdatedAt: raw.expectedUpdatedAt };
}

async function reviewProfile(raw: unknown) {
  let payload: ReturnType<typeof parseProfileReviewPayload> & { expectedUpdatedAt: string };
  try {
    payload = {
      ...parseProfileReviewPayload(raw),
      expectedUpdatedAt: expectedUpdatedAt((raw as Record<string, unknown>)?.expectedUpdatedAt),
    };
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid profile action" }, { status: 400 });
  }
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const [field] = await db.update(profileEvidence)
      .set({ verified: payload.action === "verify", updatedAt: now })
      .where(and(
        eq(profileEvidence.id, payload.id),
        eq(profileEvidence.updatedAt, payload.expectedUpdatedAt),
      ))
      .returning();
    if (field) return Response.json({ field });

    const [existing] = await db.select().from(profileEvidence).where(eq(profileEvidence.id, payload.id)).limit(1);
    if (!existing) return Response.json({ error: "Profile field not found" }, { status: 404 });
    return Response.json({
      error: "Profile field changed; reload and review the exact current value before changing verification",
    }, { status: 409 });
  } catch (error) {
    return scoutServerError("profile.review", error, "Unable to review application profile field");
  }
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const fields = await getDb().select().from(profileEvidence).orderBy(desc(profileEvidence.updatedAt));
    return Response.json({ fields });
  } catch (error) {
    return scoutServerError("profile.list", error, "Unable to load application profile");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let raw: unknown;
  try { raw = await readJson(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile field" }, { status: 400 }); }

  // Compatibility for the existing Dashboard. Review still requires the exact
  // updatedAt token that came with the value shown to the owner, so an old tab
  // cannot verify a value that another tab edited in the meantime.
  const review = dashboardReviewPayload(raw);
  if (review) return reviewProfile(review);

  let payload: ReturnType<typeof parseProfileUpsertPayload>;
  try { payload = parseProfileUpsertPayload(raw); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile field" }, { status: 400 }); }
  try {
    const db = getDb();
    const existingRows = await db.select().from(profileEvidence).where(eq(profileEvidence.kind, payload.kind)).limit(2);
    if (existingRows.length > 1) {
      return Response.json({
        error: "Multiple profile evidence rows exist for this field; repair the duplicate evidence before editing or verifying it",
      }, { status: 409 });
    }

    const [existing] = existingRows;
    const now = new Date().toISOString();
    if (existing?.verified) return Response.json({ error: "Verified profile fields must be unverified before editing" }, { status: 409 });
    if (existing) {
      let expected: string;
      try { expected = expectedUpdatedAt((raw as Record<string, unknown>)?.expectedUpdatedAt); }
      catch {
        return Response.json({
          error: "Reload this profile field before editing so Scout can bind the change to the exact evidence version you reviewed",
        }, { status: 409 });
      }

      const [field] = await db.update(profileEvidence)
        .set({ claim: payload.claim, evidence: payload.evidence, verified: false, updatedAt: now })
        .where(and(
          eq(profileEvidence.id, existing.id),
          eq(profileEvidence.updatedAt, expected),
          eq(profileEvidence.verified, false),
        ))
        .returning();
      if (field) return Response.json({ field });
      return Response.json({
        error: "Profile field changed; reload the current evidence before editing",
      }, { status: 409 });
    }

    const [field] = await db.insert(profileEvidence).values({
      id: profileRecordId(payload.kind),
      ...payload,
      verified: false,
      updatedAt: now,
    }).onConflictDoNothing().returning();
    if (field) return Response.json({ field }, { status: 201 });
    return Response.json({
      error: "Profile field was created concurrently; reload the current evidence before editing",
    }, { status: 409 });
  } catch (error) {
    return scoutServerError("profile.upsert", error, "Unable to save application profile field");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  let raw: unknown;
  try { raw = await readJson(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile action" }, { status: 400 }); }
  return reviewProfile(raw);
}
