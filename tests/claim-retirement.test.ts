import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { retireApprovedClaim, selectUsableApprovedClaims, type CandidateClaim } from "../lib/scout/claims.ts";

function approvedClaim(): CandidateClaim {
  return {
    id: "claim-old",
    statement: "Older approved claim",
    evidence: "Resume evidence",
    status: "approved",
    version: 2,
    createdAt: "2026-09-09T00:00:00.000Z",
    approvedAt: "2026-09-09T01:00:00.000Z",
  };
}

test("retiring an approved claim preserves evidence and original approval timestamp", () => {
  const current = approvedClaim();
  const retired = retireApprovedClaim(current);
  assert.equal(retired.status, "rejected");
  assert.equal(retired.statement, current.statement);
  assert.equal(retired.evidence, current.evidence);
  assert.equal(retired.approvedAt, current.approvedAt);
});

test("only approved claims can enter the retirement transition", () => {
  assert.throws(
    () => retireApprovedClaim({ ...approvedClaim(), status: "draft", approvedAt: null }),
    /Only approved claims can be retired/,
  );
  assert.throws(
    () => retireApprovedClaim({ ...approvedClaim(), status: "rejected" }),
    /Only approved claims can be retired/,
  );
});

test("retired claims are excluded from downstream approved-claim selection", () => {
  const retired = retireApprovedClaim(approvedClaim());
  const active = { ...approvedClaim(), id: "claim-new", statement: "Current claim" };
  assert.deepEqual(selectUsableApprovedClaims([retired, active]).map((claim) => claim.id), ["claim-new"]);
});

test("retirement endpoint is owner-only, same-origin, version-checked, and conflict-safe", async () => {
  const route = await readFile(new URL("../app/api/claims/retire/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /expectedVersion/);
  assert.match(route, /eq\(candidateClaims\.status, "approved"\)/);
  assert.match(route, /eq\(candidateClaims\.version, current\.version\)/);
  assert.match(route, /approvedAt: current\.approvedAt/);
});

test("claim governance UI exposes retirement only for approved claims", async () => {
  const client = await readFile(new URL("../app/claims/claims-client.tsx", import.meta.url), "utf8");
  assert.match(client, /fetch\("\/api\/claims\/retire"/);
  assert.match(client, /claim\.status === "approved"/);
  assert.match(client, /Retire approved claim/);
  assert.match(client, /retired approved evidence/i);
});
