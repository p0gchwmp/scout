import assert from "node:assert/strict";
import test from "node:test";
import {
  FORM_INTELLIGENCE_CAPABILITIES,
  analyzeFormFields,
  classifyFormField,
  draftableApplicationQuestions,
  parseObservedFormFields,
  profileFieldForLabel,
  type ObservedFormField,
} from "../lib/scout/form-intelligence.ts";

const field = (overrides: Partial<ObservedFormField> = {}): ObservedFormField => ({
  id: "field-1",
  label: "Email address *",
  controlKind: "input",
  inputType: "email",
  maxLength: 320,
  required: true,
  ...overrides,
});

test("form intelligence classifies every visible field into an explicit action bucket", () => {
  const result = analyzeFormFields([
    field(),
    field({ id: "why", label: "Why are you interested in this role?", controlKind: "textarea", inputType: "textarea", maxLength: 600 }),
    field({ id: "visa", label: "Will you require visa sponsorship?", controlKind: "select", inputType: "select", maxLength: null }),
    field({ id: "source", label: "How did you hear about us?", controlKind: "select", inputType: "select", maxLength: null }),
    field({ id: "resume", label: "Upload resume", inputType: "file", maxLength: null }),
  ]);
  assert.deepEqual(result.fields.map((item) => item.category), [
    "safe_autofill",
    "draft_from_claims",
    "sensitive_manual",
    "needs_user_answer",
    "unsupported_manual",
  ]);
  assert.deepEqual(result.summary, { total: 5, safeAutofill: 1, claimDrafts: 1, needsUser: 1, sensitiveManual: 1, unsupportedManual: 1 });
});

test("profile autofill aliases are conservative and do not treat ambiguous degree or referral name as verified fields", () => {
  assert.equal(profileFieldForLabel("Your full name *"), "full_name");
  assert.equal(profileFieldForLabel("Expected graduation year"), "graduation_year");
  assert.equal(profileFieldForLabel("Degree program"), "program");
  assert.equal(profileFieldForLabel("Do you have a degree?"), null);
  assert.equal(profileFieldForLabel("Referrer name"), null);
});

test("sensitive questions and choice controls never become claim drafts", () => {
  assert.equal(classifyFormField(field({ label: "Work authorization", inputType: "text" })).category, "sensitive_manual");
  assert.equal(classifyFormField(field({ label: "Are you willing to relocate?", inputType: "radio" })).category, "needs_user_answer");
  assert.equal(classifyFormField(field({ label: "Privacy consent", inputType: "checkbox" })).category, "sensitive_manual");
});

test("only non-sensitive long free text is forwarded for approved-claim drafting", () => {
  const analyzed = analyzeFormFields([
    field({ id: "why", label: "Why this role?", controlKind: "textarea", inputType: "textarea", maxLength: 500 }),
    field({ id: "salary", label: "Expected salary", controlKind: "textarea", inputType: "textarea", maxLength: 500 }),
    field({ id: "city", label: "Current city", inputType: "text", maxLength: 120 }),
  ]);
  assert.deepEqual(draftableApplicationQuestions(analyzed.fields), [{ id: "why", label: "Why this role?", maxLength: 500 }]);
});

test("observed form payload is bounded, value-free and rejects duplicate field ids", () => {
  assert.throws(() => parseObservedFormFields(Array.from({ length: 41 }, (_, index) => field({ id: `field-${index}` }))), /Too many/);
  assert.throws(() => parseObservedFormFields([field(), field()]), /unique/);
  const parsed = parseObservedFormFields([{ ...field(), value: "secret applicant answer" }]);
  assert.equal("value" in parsed[0], false);
});

test("form intelligence capability surface has no submission or sensitive-answer automation", () => {
  assert.equal(FORM_INTELLIGENCE_CAPABILITIES.classifyVisibleFields, true);
  assert.equal(FORM_INTELLIGENCE_CAPABILITIES.answerSensitiveQuestions, false);
  assert.equal(FORM_INTELLIGENCE_CAPABILITIES.inferUnknownAnswers, false);
  assert.equal(FORM_INTELLIGENCE_CAPABILITIES.uploadFiles, false);
  assert.equal(FORM_INTELLIGENCE_CAPABILITIES.solveCaptcha, false);
  assert.equal(FORM_INTELLIGENCE_CAPABILITIES.submitApplication, false);
});
