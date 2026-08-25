import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("browser exchange keeps AI drafts outside the fillable task until local approval", async () => {
  const route = await readFile(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8");
  assert.match(route, /buildApplicationAnswerReview/);
  assert.match(route, /const answerReview = buildApplicationAnswerReview/);
  assert.match(route, /answers: task\.answers/);
  assert.match(route, /answerReview,/);
  assert.match(route, /aiAnswersRequireExplicitApprovalBeforeFill: true/);
  assert.doesNotMatch(route, /answers:\s*\[\.\.\.task\.answers,\s*\.\.\.ai/i);
});

test("Safe Fill review approval is local, exact-task bound and must be revoked before editing", async () => {
  const popup = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  assert.match(popup, /review\.applicationId === task\.applicationId/);
  assert.match(popup, /review\.artifactVersion === task\.artifactVersion/);
  assert.match(popup, /review\.expiresAt === task\.expiresAt/);
  assert.match(popup, /reviewedAt: Date\.now\(\)/);
  assert.match(popup, /sourceField: answerSource\(questionId\)/);
  assert.match(popup, /revokeDraftApproval/);
  assert.match(popup, /textarea\.disabled = draft\.decision === "approved"/);
  assert.match(popup, /withoutReviewedAnswer/);
  assert.doesNotMatch(popup, /fetch\([^\n]*approve|send.*answer.*review/i);
});
