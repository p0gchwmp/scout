import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { candidateClaims } from "../../../db/schema";
import {
  parseClaimCreatePayload,
  parseClaimMutationPayload,
  PayloadValidationError,
} from "../../../lib/scout/api-validation";
import { approveClaim, editClaim, rejectClaim, type CandidateClaim } from "../../../lib/scout/claims";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

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

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const claims = await getDb().select().from(candidateClaims).orderBy(desc(candidateClaims.createdAt));
    return Response.json({ claims });
  } catch (error) {
    return scoutServerError("claims.list", error, "Unable to load claims");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseClaimCreatePayload>;
  try {
    payload = parseClaimCreatePayload(await readJson(request));
  } catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const [claim] = await getDb().insert(candidateClaims).values({
      id: crypto.randomUUID(),
      ...payload,
      status: "draft",
      version: 1,
    }).returning();
    return Response.json({ claim }, { status: 201 });
  } catch (error) {
    return scoutServerError("claims.create", error, "Unable to create claim");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseClaimMutationPayload>;
  try {
    payload = parseClaimMutationPayload(await readJson(request));
  } catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [row] = await db.select().from(candidateClaims).where(eq(candidateClaims.id, payload.id)).limit(1);
    if (!row) return Response.json({ error: "Claim not found" }, { status: 404 });
    if (row.version !== payload.expectedVersion) {
      return Response.json({ error: "Claim changed; reload and retry" }, { status: 409 });
    }

    const current = asClaim(row);
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
    if (!claim) return Response.json({ error: "Claim changed; reload and retry" }, { status: 409 });
    return Response.json({ claim });
  } catch (error) {
    if (error instanceof Error && /immutable|Only draft|Rejected/i.test(error.message)) {
      return Response.json({ error: "Claim state changed; reload and retry" }, { status: 409 });
    }
    return scoutServerError("claims.update", error, "Unable to update claim");
  }
}
