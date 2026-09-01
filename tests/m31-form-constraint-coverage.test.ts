import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFormFields, applicationFormConstraintKind, draftableApplicationQuestions, reviewApplicationFormConstraints } from "../lib/scout/form-intelligence.ts";

function field(id: string, label: string, controlKind: "input" | "textarea" | "select" = "input", inputType = "text", maxLength: number | null = 200, required = true) {
  return { id, label, controlKind, inputType, maxLength, required };
}

test("M31 keeps common work-authorization and sponsorship wording sensitive and out of AI drafting", () => {
  const form = analyzeFormFields([
    field("auth", "Are you authorized to work in the United States?", "select", "select", null),
    field("sponsor", "Will you now or in the future require sponsorship for employment?", "textarea", "textarea", 1000),
    field("permit", "Do you currently hold a valid work permit?", "input", "text", 100),
    field("visa", "What is your current visa status?", "input", "text", 100),
  ]);

  assert.deepEqual(form.fields.map((item) => item.category), ["sensitive_manual", "sensitive_manual", "sensitive_manual", "sensitive_manual"]);
  assert.deepEqual(form.fields.map((item) => applicationFormConstraintKind(item.label)), ["work_authorization", "work_authorization", "work_authorization", "work_authorization"]);
  assert.deepEqual(draftableApplicationQuestions(form.fields), []);
  assert.equal(reviewApplicationFormConstraints(form.fields).counts.work_authorization, 4);
});

test("M31 recognizes daily, weekly and clock-time schedule commitments as manual constraints", () => {
  const form = analyzeFormFields([
    field("daily", "Can you commit 6 hours per day?"),
    field("weekly", "Can you work at least 20 hours per week?"),
    field("days", "Are you available 5 days per week?"),
    field("clock", "Can you work 9:30 am to 5:30 pm?"),
    field("weekdays", "Can you work Monday through Friday?"),
  ]);
  const review = reviewApplicationFormConstraints(form.fields);

  assert.deepEqual(form.fields.map((item) => item.category), Array(5).fill("needs_user_answer"));
  assert.equal(review.counts.schedule_commitment, 5);
  assert.deepEqual(draftableApplicationQuestions(form.fields), []);
});

test("M31 distinguishes reusable education facts from per-application enrollment and graduation eligibility", () => {
  const form = analyzeFormFields([
    field("program", "Degree program"),
    field("field", "Field of study"),
    field("grad", "Expected graduation year"),
    field("enrolled", "Are you currently enrolled as an undergraduate student?", "select", "select", null),
    field("semester", "What is your current semester?"),
  ]);
  const review = reviewApplicationFormConstraints(form.fields);

  assert.equal(form.fields[0]?.category, "safe_autofill");
  assert.equal(form.fields[1]?.category, "safe_autofill");
  assert.deepEqual(form.fields.slice(2).map((item) => item.category), ["needs_user_answer", "needs_user_answer", "needs_user_answer"]);
  assert.equal(review.counts.graduation_or_degree, 3);
  assert.equal(review.constraints.some((item) => item.fieldId === "program"), false);
  assert.equal(review.constraints.some((item) => item.fieldId === "field"), false);
});

test("M31 recognizes joining and availability wording without turning it into claim-backed prose", () => {
  const form = analyzeFormFields([
    field("start", "What is your earliest start date?"),
    field("join", "When can you join?"),
    field("notice", "What is your notice period?"),
    field("available", "Available from"),
  ]);
  const review = reviewApplicationFormConstraints(form.fields);
  const manualCategories = new Set(["needs_user_answer", "sensitive_manual"]);

  assert.equal(form.fields.every((item) => manualCategories.has(item.category)), true);
  assert.deepEqual(form.fields.map((item) => applicationFormConstraintKind(item.label)), Array(4).fill("availability"));
  assert.equal(review.counts.availability, 4);
  assert.deepEqual(draftableApplicationQuestions(form.fields), []);
});

test("M31 leaves ordinary long-form motivation questions in the approved-claim review lane", () => {
  const form = analyzeFormFields([
    field("why", "Why are you interested in this internship?", "textarea", "textarea", 1200),
  ]);

  assert.equal(form.fields[0]?.category, "draft_from_claims");
  assert.equal(reviewApplicationFormConstraints(form.fields).required, false);
  assert.deepEqual(draftableApplicationQuestions(form.fields).map((item) => item.id), ["why"]);
});
