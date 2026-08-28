import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_REVIEW_PACKET_CAPABILITIES,
  applicationPacketMatchesCurrentSnapshot,
  buildApplicationReviewPacket,
} from "../lib/scout/application-review-packet.ts";

const snapshot = {
  id: "snap_current",
  canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
  company: "Acme",
  title: "Product Operations Intern",
  description: "Summer 2027 internship from June 1, 2027 to July 30, 2027. 20 hours per week.",
  location: "India / Remote",
  workplaceType: "remote",
  postedAt: "2026-08-20T00:00:00.000Z",
  eligibilityRisks: ["Graduation-year answer requires review"],
};
const quality = {
  score: 90,
  tier: "strong_evidence" as const,
  label: "Strong opportunity evidence",
  evidenceLabel: "Official evidence bound",
  officialSnapshot: true,
  registeredSource: true,
  companyDomain: "acme.example",
  careersUrl: "https://acme.example/careers",
  provider: "greenhouse",
  compensation: { status: "explicit_paid" as const, text: "Stipend: INR 30,000 per month" },
  duration: "10 weeks",
  arrangement: "remote" as const,
  arrangementEvidence: "Remote internship",
  structureSignals: ["Published duration: 10 weeks"],
  flags: [],
  reasons: [],
  caveats: [],
};
const fit = {
  priority: "A" as const,
  priorityLabel: "Priority A",
  priorityReasons: ["Strong role and timing evidence"],
  timingLane: "summer_2027" as const,
  summer2027: "exact" as const,
  summerReason: "Published dates fit the approved Summer 2027 window.",
  collegeCompatibility: "compatible" as const,
  collegeReason: "Published workload is 20 hours per week with flexible scheduling.",
  roleFit: "strong" as const,
  roleReason: "Product operations is a core role family.",
  eligibility: "compatible" as const,
  eligibilityReasons: ["Currently enrolled undergraduate students are eligible."],
  duration: { text: "10 weeks", weeks: 10, evidence: "10-week internship" },
  hoursPerWeek: { min: 20, max: 20, evidence: "20 hours per week" },
  dateWindow: { start: "2027-06-01", end: "2027-07-30", evidence: "June 1, 2027 to July 30, 2027" },
  freshness: { status: "fresh" as const, daysOld: 9 },
  evidence: [
    { code: "summer_dates", label: "Summer dates", excerpt: "June 1, 2027 to July 30, 2027" },
    { code: "hours", label: "Weekly hours", excerpt: "20 hours per week" },
  ],
  unknowns: ["work authorization"],
};
const alignment = {
  band: "strong" as const,
  label: "Strong evidence overlap",
  matches: ["Product & operations", "Research & analysis"],
  supportingClaims: [
    { theme: "Product & operations", label: "Product & operations", claimIds: ["claim_product", "claim_rejected"] },
  ],
  gaps: [],
  eligibilityGaps: [],
  basis: "2 approved resume claims",
  notChecked: ["Work authorization", "Availability"],
  caveats: ["Work authorization", "Availability"],
};
const readiness = {
  status: "ready" as const,
  label: "Ready for Safe Fill",
  blockers: [],
  criticalBlockers: [],
  claimIds: ["claim_product", "claim_rejected"],
  profileSummary: "6/6 required profile fields verified",
  manualConfirmations: ["Graduation year / degree path", "Work authorization"],
  alignment,
};
const claims = [
  { id: "claim_product", statement: "Mapped clinic workflows and built a prototype.", evidence: "Approved project evidence.", status: "approved" as const },
  { id: "claim_rejected", statement: "Should never appear.", evidence: "Rejected.", status: "rejected" as const },
  { id: "claim_unrelated", statement: "Approved but not selected.", evidence: "Other evidence.", status: "approved" as const },
];

test("review packet is pinned to immutable official evidence and exact M7 excerpts", () => {
  const packet = buildApplicationReviewPacket({ snapshot, quality, fit, readiness, claims, generatedAt: "2026-08-29T00:00:00.000Z" });
  assert.equal(packet.jobSnapshotId, "snap_current");
  assert.equal(packet.officialEvidence.canonicalUrl, snapshot.canonicalUrl);
  assert.equal(packet.schedulingAndEligibility.summer2027, "exact");
  assert.equal(packet.schedulingAndEligibility.exactEvidence[0].excerpt, "June 1, 2027 to July 30, 2027");
  assert.deepEqual(packet.schedulingAndEligibility.persistedEligibilityRisks, ["Graduation-year answer requires review"]);
});

test("only approved supporting claim ids become packet claim bindings", () => {
  const packet = buildApplicationReviewPacket({ snapshot, quality, fit, readiness, claims });
  assert.deepEqual(packet.resumeEvidence.claimBindings.map((claim) => claim.id), ["claim_product"]);
  assert.deepEqual(packet.resumeEvidence.supportingClaims[0].claimIds, ["claim_product"]);
  assert.doesNotMatch(JSON.stringify(packet.resumeEvidence), /Should never appear/);
});

test("outreach becomes reviewable only for accepted public contact evidence pinned to this exact snapshot", () => {
  const packet = buildApplicationReviewPacket({
    snapshot, quality, fit, readiness, claims,
    contacts: [
      { id: "accepted_old", jobSnapshotId: "snap_old", reviewState: "accepted" },
      { id: "review_current", jobSnapshotId: "snap_current", reviewState: "needs_review" },
    ],
  });
  assert.equal(packet.outreachReview.state, "needs_contact_review");
  assert.equal(packet.outreachReview.draftMayBePreparedForReview, false);

  const accepted = buildApplicationReviewPacket({
    snapshot, quality, fit, readiness, claims,
    contacts: [{ id: "accepted_current", jobSnapshotId: "snap_current", reviewState: "accepted" }],
  });
  assert.equal(accepted.outreachReview.state, "contact_accepted");
  assert.deepEqual(accepted.outreachReview.acceptedContactIds, ["accepted_current"]);
  assert.equal(accepted.outreachReview.sendAvailable, false);
});

test("explicit hard risk changes review state but never auto-rejects or applies", () => {
  const riskyQuality = { ...quality, flags: [{ code: "candidate_payment", severity: "high" as const, label: "Candidate payment / fee language", evidence: "Registration fee required" }] };
  const packet = buildApplicationReviewPacket({ snapshot, quality: riskyQuality, fit, readiness, claims });
  assert.equal(packet.applicationReview.state, "hold_for_human_review");
  assert.equal(packet.safety.autoRejectOpportunity, false);
  assert.equal(packet.safety.autoApply, false);
  assert.equal(packet.safety.submitApplication, false);
});

test("application packet snapshot guard fails closed when a posting changes", () => {
  const packet = { schemaVersion: 1, jobSnapshotId: "snap_old" };
  assert.equal(applicationPacketMatchesCurrentSnapshot(packet, "snap_current"), false);
  assert.equal(applicationPacketMatchesCurrentSnapshot(packet, "snap_old"), true);
  assert.equal(applicationPacketMatchesCurrentSnapshot({}, "snap_current"), false);
  assert.equal(applicationPacketMatchesCurrentSnapshot(packet, null), false);
});

test("review packet exposes no automatic apply, submit, reject, or send capability", () => {
  assert.equal(APPLICATION_REVIEW_PACKET_CAPABILITIES.autoRejectOpportunity, false);
  assert.equal(APPLICATION_REVIEW_PACKET_CAPABILITIES.autoApply, false);
  assert.equal(APPLICATION_REVIEW_PACKET_CAPABILITIES.submitApplication, false);
  assert.equal(APPLICATION_REVIEW_PACKET_CAPABILITIES.sendOutreach, false);
});
