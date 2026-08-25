import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { profileEvidence } from "../../../db/schema";
import { parseProfileReviewPayload, parseProfileUpsertPayload, PayloadValidationError } from "../../../lib/scout/api-validation";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

async function readJson(request: Request) {
  try { return await request.json(); }
  catch { throw new PayloadValidationError("A JSON body is required"); }
}

function dashboardReviewPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { id?: unknown; action?: unknown; verified?: unknown };
  if (raw.action !== "verify" && raw.action !== "unverify") return null;
  const action = typeof raw.verified === "boolean"
    ? (raw.verified ? "verify" : "unverify")
    : raw.action;
  return { id: raw.id, action };
}

async function reviewProfile(raw: unknown) {
  let payload: ReturnType<typeof parseProfileReviewPayload>;
  try { payload = parseProfileReviewPayload(raw); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile action" }, { status: 400 }); }
  try {
    const [field] = await getDb().update(profileEvidence).set({ verified: payload.action === "verify", updatedAt: new Date().toISOString() }).where(eq(profileEvidence.id, payload.id)).returning();
    if (!field) return Response.json({ error: "Profile field not found" }, { status: 404 });
    return Response.json({ field });
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

  // Compatibility for the existing Dashboard. The canonical review verb is PATCH,
  // but an already-open client may POST {action:"verify", id, verified:false}.
  const review = dashboardReviewPayload(raw);
  if (review) return reviewProfile(review);

  let payload: ReturnType<typeof parseProfileUpsertPayload>;
  try { payload = parseProfileUpsertPayload(raw); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile field" }, { status: 400 }); }
  try {
    const db = getDb();
    const [existing] = await db.select().from(profileEvidence).where(eq(profileEvidence.kind, payload.kind)).limit(1);
    const now = new Date().toISOString();
    if (existing?.verified) return Response.json({ error: "Verified profile fields must be unverified before editing" }, { status: 409 });
    if (existing) {
      const [field] = await db.update(profileEvidence).set({ claim: payload.claim, evidence: payload.evidence, verified: false, updatedAt: now }).where(eq(profileEvidence.id, existing.id)).returning();
      return Response.json({ field });
    }
    const [field] = await db.insert(profileEvidence).values({ id: crypto.randomUUID(), ...payload, verified: false, updatedAt: now }).returning();
    return Response.json({ field }, { status: 201 });
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
