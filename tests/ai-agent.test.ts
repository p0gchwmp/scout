import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_AGENT_CAPABILITIES,
  buildAiOutreachEnvelope,
  buildPublishedContactClassificationInput,
  validateAiContactClassifications,
  validateAiOutreachResult,
} from "../lib/scout/ai-agent.ts";

const envelope = buildAiOutreachEnvelope({
  jobSnapshotId: "snapshot-1",
  companyName: "Example Health",
  roleTitle: "Product Intern",
  candidateName: "Ryan Mahajan",
  contact: {
    id: "contact-1",
    email: "careers@example.com",
    sourceUrl: "https://example.com/careers",
    excerpt: "For internship opportunities contact careers@example.com",
    reviewState: "accepted",
  },
  claims: [
    { id: "claim-b", statement: "Mapped clinic workflows and edge cases", status: "approved" },
    { id: "claim-a", statement: "Built a Node.js, Express and SQLite clinic operations prototype", status: "approved" },
  ],
});

test("AI agent cannot send or submit", () => {
  assert.equal(AI_AGENT_CAPABILITIES.sendEmail, false);
  assert.equal(AI_AGENT_CAPABILITIES.submitApplication, false);
  assert.equal(AI_AGENT_CAPABILITIES.inventContact, false);
  assert.equal(envelope.constraints.sendAllowed, false);
});

test("AI outreach envelope is pinned to accepted contact and approved claims", () => {
  assert.equal(envelope.jobSnapshotId, "snapshot-1");
  assert.equal(envelope.contact.id, "contact-1");
  assert.deepEqual(envelope.claims.map((claim) => claim.id), ["claim-a", "claim-b"]);
  assert.throws(() => buildAiOutreachEnvelope({
    ...envelope,
    contact: { ...envelope.contact, reviewState: "needs_review" as never },
  }), /accepted contact evidence/);
});

test("AI outreach output cannot cite an unapproved claim id", () => {
  assert.deepEqual(validateAiOutreachResult({
    subject: "Product internship at Example Health",
    body: "Short personalized note grounded in approved evidence.",
    usedClaimIds: ["claim-b", "claim-a"],
  }, envelope).usedClaimIds, ["claim-a", "claim-b"]);

  assert.throws(() => validateAiOutreachResult({
    subject: "Product internship",
    body: "Invented unsupported background.",
    usedClaimIds: ["claim-secret"],
  }, envelope), /unapproved claim id/);
});

test("contact classification can only classify published candidates supplied by Scout", () => {
  const input = buildPublishedContactClassificationInput([{
    id: "candidate-1",
    email: "internships@example.com",
    sourceUrl: "https://example.com/careers",
    excerpt: "Internship queries: internships@example.com",
    sourceType: "official_careers",
  }]);
  assert.match(input.instruction, /Never invent/);

  const classified = validateAiContactClassifications([{
    candidateId: "candidate-1",
    suitability: "high",
    reason: "Explicit internship contact on the official careers page",
  }], input.candidates.map((candidate) => candidate.id));
  assert.equal(classified[0].candidateId, "candidate-1");

  assert.throws(() => validateAiContactClassifications([{
    candidateId: "invented-candidate",
    suitability: "high",
    reason: "Guessed",
  }], input.candidates.map((candidate) => candidate.id)), /was not provided/);
});
