import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { candidateClaims } from "../../../../db/schema";
import { retireApprovedClaim, type CandidateClaim } from "../../../../lib/scout/claims";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

function asClaim(row: typeof candidateClaims.$inferSelect): CandidateClaim {
  return {
    id: row.id,
    statement: row.statement,
    evidence: row.evidence,
    status: row.status,
    version: row.version,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  };
}

function parsePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A JSON object is required");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || !payload.id.trim() || payload.id.length > 128 || /[\r\n]/.test(payload.id)) {
    throw new Error("A valid claim id is required");
  }
  if (!Number.isInteger(payload.expectedVersion) || (payload.expectedVersion as number) < 1 || (payload.expectedVersion as number) > 2_147_483_647) {
    throw new Error("A valid expectedVersion is required");
  }
  return { id: payload.id.trim(), expectedVersion: payload.expectedVersion as number };
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parsePayload>;
  try {
    payload = parsePayload(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [row] = await db.select().from(candidateClaims).where(eq(candidateClaims.id, payload.id)).limit(1);
    if (!row) return Response.json({ error: "Claim not found" }, { status: 404 });
    if (row.version !== payload.expectedVersion) {
      return Response.json({ error: "Claim changed; reload and retry" }, { status: 409 });
    }

    const current = asClaim(row);
    let next: CandidateClaim;
    try {
      next = retireApprovedClaim(current);
    } catch {
      return Response.json({ error: "Only currently approved claims can be retired" }, { status: 409 });
    }

    const now = new Date().toISOString();
    const [claim] = await db.update(candidateClaims)
      .set({
        status: next.status,
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

    if (!claim) return Response.json({ error: "Claim changed; reload and retry" }, { status: 409 });
    return Response.json({ claim });
  } catch (error) {
    return scoutServerError("claims.retire", error, "Unable to retire approved claim");
  }
}
