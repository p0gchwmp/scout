import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prep = await readFile(new URL("../lib/scout/application-prep.ts", import.meta.url), "utf8");
const handoff = await readFile(new URL("../app/api/applications/browser-task/route.ts", import.meta.url), "utf8");
const exchange = await readFile(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8");

test("prepared application packets carry verified profile evidence bindings", () => {
  assert.match(prep, /buildApplicationProfileBindings/);
  assert.match(prep, /profileBindings/);
  assert.match(prep, /pinVerifiedProfileEvidence: true/);
  assert.match(prep, /externalSideEffect: false/);
});

test("handoff minting fails closed when reusable profile evidence changed", () => {
  assert.match(handoff, /profileEvidence/);
  assert.match(handoff, /applicationPacketProfileBindingIssues/);
  assert.match(handoff, /verified profile evidence changed/i);
  assert.ok(handoff.indexOf("applicationPacketProfileBindingIssues") < handoff.indexOf("const task = buildBrowserAssistTask"));
});

test("browser exchange rechecks profile bindings after handoff minting and before fill or AI drafting", () => {
  assert.match(exchange, /currentProfileFields/);
  assert.match(exchange, /applicationPacketProfileBindingIssues/);
  assert.match(exchange, /Verified profile evidence changed after the browser handoff was minted/);
  assert.ok(exchange.indexOf("applicationPacketProfileBindingIssues") < exchange.indexOf("const task = buildBrowserAssistTask"));
  assert.ok(exchange.indexOf("applicationPacketProfileBindingIssues") < exchange.indexOf("const ai = await draftApplicationAnswersViaAgent"));
});

test("M10 adds no submit, CAPTCHA, sensitive-answer, send, or inferred-profile capability", () => {
  const joined = `${prep}\n${handoff}\n${exchange}`;
  assert.match(joined, /submitApplication: false/);
  assert.match(joined, /solveCaptcha: false/);
  assert.match(exchange, /sensitiveQuestionsRequireReview: true/);
  assert.match(exchange, /aiAnswersRequireExplicitApprovalBeforeFill: true/);
  assert.doesNotMatch(joined, /sendEmail|submitApplication\s*:\s*true|solveCaptcha\s*:\s*true/);
});
