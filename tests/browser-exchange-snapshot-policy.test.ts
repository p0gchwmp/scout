import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8");

test("browser exchange re-checks the application packet against the current immutable job snapshot", () => {
  assert.match(route, /applicationPacketSnapshotId/);
  assert.match(route, /applicationPacketMatchesCurrentSnapshot/);
  assert.match(route, /jobSnapshots/);
  assert.match(route, /eq\(jobSnapshots\.jobId, application\.jobId\)/);
  assert.match(route, /job snapshot changed after the browser handoff was minted/);
  assert.match(route, /status|409/);
  assert.ok(route.indexOf("applicationPacketMatchesCurrentSnapshot") < route.indexOf("const task = buildBrowserAssistTask"));
});

test("AI application answers are grounded in immutable snapshot content, not the mutable jobs row", () => {
  assert.match(route, /jobSnapshotId: snapshot\.id/);
  assert.match(route, /companyName: snapshot\.company/);
  assert.match(route, /roleTitle: snapshot\.title/);
  assert.match(route, /jobDescription: snapshot\.description\.slice\(0, 12_000\)/);
  assert.doesNotMatch(route, /companyName: job\.company/);
  assert.doesNotMatch(route, /roleTitle: job\.title/);
  assert.doesNotMatch(route, /jobDescription: job\.description/);
});

test("claim-backed answer drafting fails closed if any packet claim binding is no longer approved", () => {
  assert.match(route, /claims\.length === claimIds\.length/);
  assert.match(route, /claims\.every\(\(claim\) => claim\.status === "approved"\)/);
  assert.match(route, /Current approved claim bindings are required/);
});

test("M9 does not add submit, sensitive-answer, CAPTCHA, or send capability", () => {
  assert.match(route, /aiAnswersRequireExplicitApprovalBeforeFill: true/);
  assert.match(route, /sensitiveQuestionsRequireReview: true/);
  assert.match(route, /solveCaptcha: false/);
  assert.match(route, /submitApplication: false/);
  assert.doesNotMatch(route, /sendEmail|submitApplication\s*:\s*true|solveCaptcha\s*:\s*true/);
});
