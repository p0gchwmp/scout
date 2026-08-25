import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8");

test("handoff server independently reclassifies browser field metadata", () => {
  assert.match(route, /analyzeFormFields/);
  assert.match(route, /record\.fields === undefined \? null : analyzeFormFields\(record\.fields\)/);
  assert.match(route, /draftableApplicationQuestions\(form\.fields\)/);
  assert.match(route, /field\.category === "sensitive_manual"/);
  assert.match(route, /field\.category === "needs_user_answer"/);
  assert.match(route, /field\.category === "unsupported_manual"/);
});

test("handoff never trusts browser answers or forwards sensitive and unknown controls to AI", () => {
  assert.match(route, /questions: draftableQuestions/);
  assert.doesNotMatch(route, /questions: input\.questions/);
  assert.match(route, /browserSentFieldValues: false/);
  assert.match(route, /unknownAnswersRequireUser: true/);
  assert.match(route, /sensitiveQuestionsRequireReview: true/);
  assert.match(route, /submitApplication: false/);
});

test("handoff accepts only bounded metadata keys in addition to the signed token and exact page URL", () => {
  assert.match(route, /key !== "token" && key !== "currentUrl" && key !== "questions" && key !== "fields"/);
  assert.match(route, /verifyBrowserHandoffToken/);
  assert.match(route, /eq\(applications\.artifactVersion, verified\.artifactVersion\)/);
  assert.match(route, /eq\(applications\.status, "ready_for_review"\)/);
});
