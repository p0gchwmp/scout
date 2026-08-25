import type { AiApplicationAnswer, ApplicationQuestion } from "./ai-agent.ts";

export const APPLICATION_ANSWER_REVIEW_CAPABILITIES = Object.freeze({
  reviewDrafts: true,
  editDraftsLocally: true,
  approveDraftForFill: true,
  fillBeforeApproval: false,
  answerSensitiveQuestions: false,
  submitApplication: false,
} as const);

export type ApplicationAnswerReviewDraft = {
  questionId: string;
  label: string;
  maxLength: number | null;
  proposedAnswer: string;
  usedClaimIds: string[];
  decision: "pending";
  fillAllowed: false;
};

export type ApplicationAnswerReview = {
  schemaVersion: 1;
  state: "needs_review" | "not_needed";
  drafts: ApplicationAnswerReviewDraft[];
};

export function buildApplicationAnswerReview(input: {
  questions: ApplicationQuestion[];
  answers: AiApplicationAnswer[];
}): ApplicationAnswerReview {
  const byQuestionId = new Map(input.questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  const answersByQuestionId = new Map(input.answers.map((answer) => {
    if (seen.has(answer.questionId)) throw new Error("Application answer review contains a duplicate question id");
    seen.add(answer.questionId);
    if (!byQuestionId.has(answer.questionId)) throw new Error("Application answer review contains an unknown question id");
    return [answer.questionId, answer] as const;
  }));

  const drafts = input.questions.flatMap((question) => {
    const answer = answersByQuestionId.get(question.id);
    if (!answer) return [];
    return [{
      questionId: question.id,
      label: question.label,
      maxLength: question.maxLength,
      proposedAnswer: answer.answer,
      usedClaimIds: [...answer.usedClaimIds],
      decision: "pending" as const,
      fillAllowed: false as const,
    }];
  });

  return {
    schemaVersion: 1,
    state: drafts.length ? "needs_review" : "not_needed",
    drafts,
  };
}
