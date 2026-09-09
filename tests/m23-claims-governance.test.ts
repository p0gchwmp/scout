import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/claims/page.tsx", "utf8");
const client = readFileSync("app/claims/claims-client.tsx", "utf8");
const route = readFileSync("app/api/claims/route.ts", "utf8");
const claims = readFileSync("lib/scout/claims.ts", "utf8");
const alignment = readFileSync("lib/scout/resume-alignment.ts", "utf8");
const dashboard = readFileSync("app/dashboard.tsx", "utf8");

// M23 is intentionally a governance/UI hardening milestone. It reuses the
// existing owner-only, CAS-protected claims API instead of adding a new write path.
test("M23 claims page is owner-only", () => {
  assert.match(page, /requireChatGPTUser\("\/claims"\)/);
  assert.match(page, /requireScoutPageOwner\(user, getScoutOwnerUserId\)/);
});

test("M23 shows exact claim identity, version, evidence and status", () => {
  assert.match(client, /<code>\{claim\.id\}<\/code>/);
  assert.match(client, /Version \{claim\.version\}/);
  assert.match(client, /\{claim\.evidence\}/);
  assert.match(client, /styles\[claim\.status\]/);
});

test("M23 draft edits and decisions are pinned to expectedVersion", () => {
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /expectedVersion: claim\.version/);
  assert.match(route, /row\.version !== payload\.expectedVersion/);
  assert.match(route, /eq\(candidateClaims\.version, current\.version\)/);
});

test("M23 cannot approve or reject unsaved draft edits", () => {
  assert.match(client, /disabled=\{dirty \|\| claimBusy\}/);
  assert.match(client, /Save this version before approving or rejecting it/);
  assert.match(client, /Approve saved version/);
});

test("approved and rejected claims are immutable or excluded", () => {
  assert.match(claims, /Approved candidate claims are immutable/);
  assert.match(claims, /Rejected candidate claims cannot be edited/);
  assert.match(claims, /claim\.status === "approved"/);
  assert.ok(
    /selectUsableApprovedClaims/.test(alignment)
      || /claims\.filter\(\(claim\) => claim\.status === "approved"\)/.test(dashboard),
    "resume alignment must consume approved claims only",
  );
});

test("M23 keeps external side effects out of claim review", () => {
  assert.doesNotMatch(client, /\/api\/(send|submit)/i);
  assert.doesNotMatch(route, /\/api\/(send|submit)/i);
  assert.match(client, /does not delete history, contact employers, send email, or submit applications/);
});
