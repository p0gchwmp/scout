import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { candidateClaims } from "../../../db/schema";
import {
  parseClaimCreatePayload,
  parseClaimMutationPayload,
  PayloadValidationError,
} from "../../../lib/scout/api-validation";
import { ensureClaimRetirementTrigger } from "../../../lib/scout/claim-retirement-trigger";
import { approveClaim, editClaim, rejectClaim, type CandidateClaim } from "../../../lib/scout/claims";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

const NO_STORE_HEADERS = { "cache-control": "private, no-store, max-age=0, must-revalidate" };

const asClaim = (row: typeof candidateClaims.$inferSelect): CandidateClaim => ({
  id: row.id,
  statement: row.statement,
  evidence: row.evidence,
  status: row.status,
  version: row.version,
  approvedAt: row.approvedAt,
  createdAt: row.createdAt,
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new PayloadValidationError("A JSON body is required");
  }
}

function isMutation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = (value as { action?: unknown }).action;
  return action === "edit" || action === "approve" || action === "reject" || action === "retire";
}

async function mutateClaim(raw: unknown) {
  let payload: ReturnType<typeof parseClaimMutationPayload>;
  try {
    payload = parseClaimMutationPayload(raw);
  } catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE_HEADERS });
    return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const db = getDb();
    const [row] = await db.select().from(candidateClaims).where(eq(candidateClaims.id, payload.id)).limit(1);
    if (!row) return Response.json({ error: "Claim not found" }, { status: 404, headers: NO_STORE_HEADERS });

    const current = asClaim(row);

    // Retirement is a monotonic state transition. If the database already says
    // this approved claim is retired, return the current row as a successful
    // idempotent no-op instead of trapping a stale client in a 409 loop.
    if (payload.action === "retire") {
      const alreadyRetired = current.status === "rejected" && Boolean(current.approvedAt);
      if (alreadyRetired) {
        return Response.json({ claim: row, alreadyRetired: true }, { headers: NO_STORE_HEADERS });
      }
      if (current.status !== "approved") {
        return Response.json({ error: "Only currently approved claims can be retired" }, { status: 409, headers: NO_STORE_HEADERS });
      }
      if (!current.approvedAt) {
        return Response.json({ error: "Approved claim is missing its approval timestamp; refusing retirement" }, { status: 409, headers: NO_STORE_HEADERS });
      }
      if (current.version !== payload.expectedVersion) {
        return Response.json({ error: "Claim changed; reload and retry" }, { status: 409, headers: NO_STORE_HEADERS });
      }

      // The original schema trigger blocked every update whose OLD status was
      // approved, including the deliberately constrained retirement transition.
      // Upgrade only that known legacy trigger, fail closed on unknown trigger
      // definitions, then execute the version-pinned retirement update.
      await ensureClaimRetirementTrigger(env.DB);

      const now = new Date().toISOString();
      const [claim] = await db.update(candidateClaims)
        .set({
          status: "rejected",
          version: current.version + 1,
          approvedAt: current.approvedAt,
          updatedAt: now,
        })
        .where(and(
          eq(candidateClaims.id, current.id),
          eq(candidateClaims.status, "approved"),
          eq(candidateClaims.version, current.version),
        ))
        .returning();

      if (!claim) return Response.json({ error: "Claim changed; reload and retry" }, { status: 409, headers: NO_STORE_HEADERS });
      return Response.json({ claim }, { headers: NO_STORE_HEADERS });
    }

    if (row.version !== payload.expectedVersion) {
      return Response.json({ error: "Claim changed; reload and retry" }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const now = new Date().toISOString();
    const next = payload.action === "approve"
      ? approveClaim(current, now)
      : payload.action === "reject"
        ? rejectClaim(current)
        : editClaim(current, { statement: payload.statement, evidence: payload.evidence });
    const [claim] = await db.update(candidateClaims)
      .set({
        statement: next.statement,
        evidence: next.evidence,
        status: next.status,
        version: current.version + 1,
        approvedAt: next.approvedAt,
        updatedAt: now,
      })
      .where(and(
        eq(candidateClaims.id, next.id),
        eq(candidateClaims.status, current.status),
        eq(candidateClaims.version, current.version),
      ))
      .returning();
    if (!claim) return Response.json({ error: "Claim changed; reload and retry" }, { status: 409, headers: NO_STORE_HEADERS });
    return Response.json({ claim }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof Error && /immutable|Only draft|Rejected/i.test(error.message)) {
      return Response.json({ error: "Claim state changed; reload and retry" }, { status: 409, headers: NO_STORE_HEADERS });
    }
    return scoutServerError("claims.update", error, "Unable to update claim");
  }
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const claims = await getDb().select().from(candidateClaims).orderBy(desc(candidateClaims.createdAt));
    return Response.json({ claims }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return scoutServerError("claims.list", error, "Unable to load claims");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Compatibility for the existing Dashboard: mutations remain fully validated
  // and owner/same-origin protected even when that client uses POST.
  if (isMutation(raw)) return mutateClaim(raw);

  let payload: ReturnType<typeof parseClaimCreatePayload>;
  try {
    payload = parseClaimCreatePayload(raw);
  } catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE_HEADERS });
    return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const [claim] = await getDb().insert(candidateClaims).values({
      id: crypto.randomUUID(),
      ...payload,
      status: "draft",
      version: 1,
    }).returning();
    return Response.json({ claim }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    return scoutServerError("claims.create", error, "Unable to create claim");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  return mutateClaim(raw);
}
