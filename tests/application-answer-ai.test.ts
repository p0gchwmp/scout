import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_AGENT_CAPABILITIES,
  buildAiApplicationAnswerEnvelope,
  buildAiOutreachEnvelope,
  validateAiApplicationAnswers,
  validateAiOutreachResult,
} from "../lib/scout/ai-agent.ts";
import { createStructuredAiProvider } from "../lib/scout/ai-provider.ts";

const claim = { id: "claim-product", statement: "Built a Node.js/Express/SQLite clinic operations prototype with workflow mapping, edge cases and automated tests.", status: "approved" as const };

function applicationEnvelope() {
  return buildAiApplicationAnswerEnvelope({
    jobSnapshotId: "snapshot-1",
    companyName: "Example Labs",
    roleTitle: "Product Intern",
    jobDescription: "The intern will work with product and operations teams on workflow problems.",
    candidateName: "Ryan Mahajan",
    questions: [{ id: "why-role", label: "Why are you interested in this role?", maxLength: 600 }],
    claims: [claim],
    voice: { sample: "I usually keep things short. I say what I worked on and why it matters to the question.", styleNote: "Understated and specific." },
  });
}

test("application-answer contract refuses sensitive questions before AI", () => {
  assert.equal(AI_AGENT_CAPABILITIES.answerSensitiveApplicationQuestions, false);
  assert.throws(() => buildAiApplicationAnswerEnvelope({
    jobSnapshotId: "snapshot-1",
    companyName: "Example Labs",
    roleTitle: "Product Intern",
    jobDescription: "Role description",
    candidateName: "Ryan Mahajan",
    questions: [{ id: "visa", label: "Will you now or in the future require visa sponsorship?", maxLength: 200 }],
    claims: [claim],
  }), /Sensitive application question requires manual confirmation/i);
});

test("application answers reject unsupported metrics and unapproved claim ids", () => {
  const envelope = applicationEnvelope();
  assert.throws(() => validateAiApplicationAnswers({ answers: [{ questionId: "why-role", answer: "I improved clinic conversion by 37% and want to apply that here.", usedClaimIds: [claim.id] }] }, envelope), /number or metric/i);
  assert.throws(() => validateAiApplicationAnswers({ answers: [{ questionId: "why-role", answer: "I worked on a clinic operations prototype and liked the workflow side of it.", usedClaimIds: ["claim-made-up"] }] }, envelope), /unapproved claim/i);
});

test("outreach validator rejects newly invented numbers even after style rewrite", () => {
  const envelope = buildAiOutreachEnvelope({
    jobSnapshotId: "snapshot-1",
    companyName: "Example Labs",
    roleTitle: "Product Intern",
    candidateName: "Ryan Mahajan",
    contact: { id: "contact-1", email: "careers@example.com", sourceUrl: "https://example.com/careers", excerpt: "For roles contact careers@example.com", reviewState: "accepted" },
    claims: [claim],
  });
  assert.throws(() => validateAiOutreachResult({ subject: "Product Intern", body: "I increased efficiency by 40% while building the clinic prototype.", usedClaimIds: [claim.id] }, envelope), /number or metric/i);
});

test("provider performs a constrained human-writing second pass without changing claim bindings", async () => {
  const envelope = applicationEnvelope();
  const replies = [
    { answers: [{ questionId: "why-role", answer: "I am thrilled to leverage my skills in this pivotal role. My clinic operations prototype involved workflow mapping and automated tests.", usedClaimIds: [claim.id] }] },
    { answers: [{ questionId: "why-role", answer: "I worked on a clinic operations prototype where I mapped workflows, edge cases and tests. That is why the product and operations side of this internship interests me.", usedClaimIds: [claim.id] }] },
  ];
  let calls = 0;
  const fetcher = (async () => {
    const content = JSON.stringify(replies[calls++]);
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;
  const provider = createStructuredAiProvider({
    endpointUrl: "https://ai.example.com/v1/chat/completions",
    apiKey: "test-secret-key",
    model: "test-model",
    costClass: "free_or_included",
    fetcher,
  });
  const answers = await provider.draftApplicationAnswers(envelope);
  assert.equal(calls, 2);
  assert.equal(answers[0].usedClaimIds[0], claim.id);
  assert.doesNotMatch(answers[0].answer, /thrilled|leverage|pivotal/i);
});
