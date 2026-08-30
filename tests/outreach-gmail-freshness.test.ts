import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES,
  companyOutreachExecutionIssues,
  jobOutreachExecutionIssues,
  parsePinnedOutreachClaimIds,
} from "../lib/scout/outreach-execution.ts";

test("role outreach Gmail draft execution requires current snapshot, accepted contact, current claims, recipient, and body hash", () => {
  const base = {
    jobId: "job_1",
    currentJobSnapshotId: "snap_2",
    revisionJobSnapshotId: "snap_2",
    revisionContactId: "contact_1",
    revisionClaimIds: ["claim_a", "claim_b"],
    currentUsableClaimIds: ["claim_b", "claim_a"],
    contact: {
      id: "contact_1",
      jobId: "job_1",
      jobSnapshotId: "snap_2",
      email: "recruiting@example.com",
      reviewState: "accepted",
    },
    parsedRecipient: "Recruiting@example.com",
    expectedBodyHash: "abc123",
    actualBodyHash: "abc123",
  };
  assert.deepEqual(jobOutreachExecutionIssues(base), []);
  assert.match(jobOutreachExecutionIssues({ ...base, currentJobSnapshotId: "snap_3" }).join(" "), /old job snapshot/i);
  assert.match(jobOutreachExecutionIssues({ ...base, contact: { ...base.contact, reviewState: "rejected" } }).join(" "), /no longer accepted/i);
  assert.match(jobOutreachExecutionIssues({ ...base, currentUsableClaimIds: ["claim_a"] }).join(" "), /candidate claims/i);
  assert.match(jobOutreachExecutionIssues({ ...base, parsedRecipient: "other@example.com" }).join(" "), /recipient/i);
  assert.match(jobOutreachExecutionIssues({ ...base, actualBodyHash: "changed" }).join(" "), /immutable hash/i);
});

test("company-first outreach Gmail draft execution revalidates target, accepted contact, claims, recipient, and hash", () => {
  const base = {
    targetId: "target_1",
    targetState: "active",
    revisionTargetId: "target_1",
    revisionContactId: "contact_1",
    revisionClaimIds: ["claim_a"],
    currentUsableClaimIds: ["claim_a"],
    contact: {
      id: "contact_1",
      targetId: "target_1",
      email: "careers@example.com",
      reviewState: "accepted",
    },
    parsedRecipient: "careers@example.com",
    expectedBodyHash: "abc123",
    actualBodyHash: "abc123",
  };
  assert.deepEqual(companyOutreachExecutionIssues(base), []);
  assert.match(companyOutreachExecutionIssues({ ...base, targetState: "archived" }).join(" "), /no longer active/i);
  assert.match(companyOutreachExecutionIssues({ ...base, contact: null }).join(" "), /contact evidence/i);
  assert.match(companyOutreachExecutionIssues({ ...base, currentUsableClaimIds: [] }).join(" "), /candidate claims/i);
});

test("pinned outreach claim ids are bounded, exact, and duplicate-free", () => {
  assert.deepEqual(parsePinnedOutreachClaimIds(["claim_a", "claim-b:2"]), ["claim_a", "claim-b:2"]);
  assert.equal(parsePinnedOutreachClaimIds([]), null);
  assert.equal(parsePinnedOutreachClaimIds(["claim_a", "claim_a"]), null);
  assert.equal(parsePinnedOutreachClaimIds(["bad claim id"]), null);
  assert.equal(parsePinnedOutreachClaimIds(Array.from({ length: 9 }, (_, index) => `claim_${index}`)), null);
});

test("M11 adds Gmail draft freshness checks without adding send capability", () => {
  assert.equal(OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES.createDraft, true);
  assert.equal(OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES.sendEmail, false);
  assert.equal(OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES.requireCurrentJobSnapshot, true);
  assert.equal(OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES.requireAcceptedContactEvidence, true);
  assert.equal(OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES.requireCurrentApprovedClaims, true);
  assert.equal(OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES.requirePinnedRecipientMatch, true);
  assert.equal(OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES.requireBodyHashMatch, true);
});
