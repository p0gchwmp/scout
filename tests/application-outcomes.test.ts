import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_OUTCOME_CAPABILITIES,
  normalizeFollowUpAt,
  outcomeGuidance,
  validateOutcomeTransition,
} from "../lib/scout/application-outcomes.ts";

test("M16 requires a recorded external submission before recruiter outcomes", () => {
  assert.throws(() => validateOutcomeTransition({ status: "ready_for_review", submittedAt: null }, "interview"), /submission/i);
});

test("M16 accepts explicit post-submission outcomes", () => {
  assert.equal(validateOutcomeTransition({ status: "ready_for_review", submittedAt: "2026-08-30T10:00:00Z" }, "recruiter_replied"), "recruiter_replied");
});

test("M16 preserves terminal outcomes unless explicitly cleared", () => {
  assert.throws(() => validateOutcomeTransition({ status: "offer", submittedAt: "2026-08-30T10:00:00Z" }, "rejected"), /terminal/i);
});

test("M16 only uses an explicit follow-up timestamp", () => {
  assert.equal(normalizeFollowUpAt("2026-09-05T09:30:00+05:30"), "2026-09-05T04:00:00.000Z");
  assert.throws(() => normalizeFollowUpAt("next week"), /ISO/i);
});

test("M16 guidance does not invent a follow-up cadence", () => {
  const result = outcomeGuidance({ status: "awaiting_reply", submittedAt: "2026-08-30T10:00:00Z", approvedAt: null });
  assert.match(result.guidance, /will not invent/i);
  assert.equal(result.followUpAt, null);
});

test("M16 surfaces an explicitly due follow-up", () => {
  const result = outcomeGuidance(
    { status: "awaiting_reply", submittedAt: "2026-08-20T10:00:00Z", approvedAt: "2026-08-30T10:00:00Z" },
    new Date("2026-08-30T12:00:00Z"),
  );
  assert.equal(result.followUpDue, true);
  assert.match(result.guidance, /date has arrived/i);
});

test("M16 remains non-autonomous", () => {
  assert.equal(APPLICATION_OUTCOME_CAPABILITIES.readGmailThreads, false);
  assert.equal(APPLICATION_OUTCOME_CAPABILITIES.sendFollowUp, false);
  assert.equal(APPLICATION_OUTCOME_CAPABILITIES.submitApplication, false);
  assert.equal(APPLICATION_OUTCOME_CAPABILITIES.inferRecruiterResponse, false);
});
