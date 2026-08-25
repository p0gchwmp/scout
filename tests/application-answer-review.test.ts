import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_ANSWER_REVIEW_CAPABILITIES,
  buildApplicationAnswerReview,
} from "../lib/scout/application-answer-review.ts";

const questions = [
  { id: "why-role", label: "Why are you interested in this role?", maxLength: 600 },
  { id: "project", label: "Tell us about a relevant project.", maxLength: 800 },
];

const answers = [
  { questionId: "project", answer: "I worked on a clinic operations prototype with workflow mapping and automated tests.", usedClaimIds: ["claim-clinic"] },
  { questionId: "why-role", answer: "The product and operations side of the role lines up with work I have already done on workflow problems.", usedClaimIds: ["claim-clinic", "claim-scout"] },
];

test("AI application answers remain pending and unfillable until explicit local review", () => {
  const review = buildApplicationAnswerReview({ questions, answers });
  assert.equal(review.state, "needs_review");
  assert.deepEqual(review.drafts.map((draft) => draft.questionId), ["why-role", "project"]);
  assert.ok(review.drafts.every((draft) => draft.decision === "pending"));
  assert.ok(review.drafts.every((draft) => draft.fillAllowed === false));
  assert.deepEqual(review.drafts[0].usedClaimIds, ["claim-clinic", "claim-scout"]);
});

test("answer review rejects duplicate and unknown question bindings", () => {
  assert.throws(() => buildApplicationAnswerReview({ questions, answers: [answers[0], answers[0]] }), /duplicate question id/i);
  assert.throws(() => buildApplicationAnswerReview({ questions, answers: [{ questionId: "unknown", answer: "Nope", usedClaimIds: ["claim-clinic"] }] }), /unknown question id/i);
});

test("answer review capability surface cannot fill before approval or submit applications", () => {
  assert.equal(APPLICATION_ANSWER_REVIEW_CAPABILITIES.reviewDrafts, true);
  assert.equal(APPLICATION_ANSWER_REVIEW_CAPABILITIES.approveDraftForFill, true);
  assert.equal(APPLICATION_ANSWER_REVIEW_CAPABILITIES.fillBeforeApproval, false);
  assert.equal(APPLICATION_ANSWER_REVIEW_CAPABILITIES.answerSensitiveQuestions, false);
  assert.equal(APPLICATION_ANSWER_REVIEW_CAPABILITIES.submitApplication, false);
});
