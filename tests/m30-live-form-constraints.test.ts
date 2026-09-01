import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeFormFields, FORM_INTELLIGENCE_CAPABILITIES, reviewApplicationFormConstraints } from "../lib/scout/form-intelligence.ts";

function field(id: string, label: string, controlKind: "input" | "textarea" | "select" = "select", inputType = "select", required = true) {
  return { id, label, controlKind, inputType, maxLength: null, required };
}

test("M30 detects live work-authorization, schedule, graduation and availability review constraints", () => {
  const form = analyzeFormFields([
    field("auth", "Are you legally authorized to work in the United States?"),
    field("hours", "Can you commit to at least 6 hours per day, Monday-Friday?"),
    field("grad", "What is your expected graduation year?", "input", "text"),
    field("start", "When can you start?", "input", "text"),
  ]);
  const review = reviewApplicationFormConstraints(form.fields);

  assert.equal(review.required, true);
  assert.deepEqual(review.constraints.map((item) => item.kind), [
    "work_authorization",
    "schedule_commitment",
    "graduation_or_degree",
    "availability",
  ]);
  assert.equal(review.counts.schedule_commitment, 1);
  assert.equal(FORM_INTELLIGENCE_CAPABILITIES.browserConstraintReviewUsesMetadataOnly, true);
});

test("M30 does not turn a verified reusable degree-program field into an eligibility constraint", () => {
  const form = analyzeFormFields([field("program", "Degree program", "input", "text")]);
  assert.equal(form.fields[0]?.category, "safe_autofill");
  assert.equal(reviewApplicationFormConstraints(form.fields).required, false);
});

test("M30 exchange and extension expose an exact-task acknowledgement boundary without storing answers", () => {
  const route = readFileSync(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8");
  const popup = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
  assert.match(route, /reviewApplicationFormConstraints/);
  assert.match(route, /constraintReview/);
  assert.match(route, /browserSentFieldValues: false/);
  assert.match(popup, /constraintReviewAcknowledgement/);
  assert.match(popup, /ack-constraints/);
  assert.match(popup, /SCOUT_FILL/);
});
