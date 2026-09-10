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

test("retirement uses a direct approved-only CAS transition and preserves approval history", async () => {
  const route = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /if \(payload\.action === "retire"\)/);
  assert.match(route, /current\.status !== "approved"/);
  assert.match(route, /current\.version !== payload\.expectedVersion/);
  assert.match(route, /status: "rejected"/);
  assert.match(route, /version: current\.version \+ 1/);
  assert.match(route, /approvedAt: current\.approvedAt/);
  assert.match(route, /eq\(candidateClaims\.status, "approved"\)/);
  assert.match(route, /eq\(candidateClaims\.version, current\.version\)/);
});

test("already-retired claims are an idempotent success instead of a stale-client 409 loop", async () => {
  const route = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
  assert.match(route, /alreadyRetired = current\.status === "rejected" && Boolean\(current\.approvedAt\)/);
  assert.match(route, /if \(alreadyRetired\)/);
  assert.match(route, /alreadyRetired: true/);
});

test("claim governance reads bypass caches and retirement updates local state from the mutation response", async () => {
  const [route, client] = await Promise.all([
    readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/claims/claims-client.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /cache-control/);
  assert.match(route, /private, no-store, max-age=0, must-revalidate/);
  assert.match(client, /fetch\("\/api\/claims", \{ cache: "no-store" \}\)/);
  assert.match(client, /setClaims\(\(current\) => current\.map/);
});

test("claim governance UI exposes retirement as an unmistakable button", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/claims/claims-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/claims/claims.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /action: "retire"/);
  assert.match(client, /styles\.retireButton/);
  assert.match(client, /Retire approved claim/);
  assert.match(styles, /\.retireButton/);
  assert.match(styles, /border: 1px solid currentColor/);
  assert.match(styles, /cursor: pointer/);
});
