import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseClaimMutationPayload } from "../lib/scout/api-validation.ts";
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

test("claim mutation validation accepts retirement only with a pinned version", () => {
  assert.deepEqual(
    parseClaimMutationPayload({ id: "claim-old", action: "retire", expectedVersion: 2 }),
    { id: "claim-old", action: "retire", expectedVersion: 2 },
  );
  assert.throws(() => parseClaimMutationPayload({ id: "claim-old", action: "retire", expectedVersion: 0 }));
});

test("retirement reuses the owner-only, same-origin, conflict-safe claims mutation path", async () => {
  const route = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /row\.version !== payload\.expectedVersion/);
  assert.match(route, /payload\.action === "retire"/);
  assert.match(route, /retireApprovedClaim\(current\)/);
  assert.match(route, /eq\(candidateClaims\.status, current\.status\)/);
  assert.match(route, /eq\(candidateClaims\.version, current\.version\)/);
  assert.match(route, /approvedAt: next\.approvedAt/);
});

test("claim governance UI retires approved claims through the existing PATCH endpoint", async () => {
  const client = await readFile(new URL("../app/claims/claims-client.tsx", import.meta.url), "utf8");
  assert.match(client, /fetch\("\/api\/claims"/);
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /action: "retire"/);
  assert.doesNotMatch(client, /\/api\/claims\/retire/);
  assert.match(client, /claim\.status === "approved"/);
  assert.match(client, /Retire approved claim/);
  assert.match(client, /retired approved evidence/i);
});
