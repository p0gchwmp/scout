import assert from "node:assert/strict";
import test from "node:test";
import { assessOpportunityFit, OPPORTUNITY_FIT_CAPABILITIES } from "../lib/scout/opportunity-fit.ts";
import type { OpportunityQualityAssessment, OpportunityQualityJob } from "../lib/scout/opportunity-quality-intelligence.ts";

const now = new Date("2026-09-01T00:00:00Z");

function job(overrides: Partial<OpportunityQualityJob> = {}): OpportunityQualityJob {
  return {
    company: "Acceptance Probe",
    title: "Product Intern",
    description: "Work with product and operations teams.",
    location: "Remote",
    workplaceType: "remote",
    source: "greenhouse",
    canonicalUrl: "https://job-boards.greenhouse.io/acceptance/jobs/123",
    sourceRegistryId: "source-acceptance",
    currentSnapshotId: "snapshot-acceptance",
    postedAt: "2026-08-28T00:00:00Z",
    lifecycleState: "active",
    ...overrides,
  };
}

function quality(): OpportunityQualityAssessment {
  return {
    score: 80,
    tier: "strong_evidence",
    label: "Strong opportunity evidence",
    evidenceLabel: "Official evidence bound",
    officialSnapshot: true,
    registeredSource: true,
    companyDomain: "acceptance.example",
    careersUrl: "https://acceptance.example/careers",
    provider: "greenhouse",
    compensation: { status: "not_published", text: null },
    duration: null,
    arrangement: "remote",
    arrangementEvidence: "Persisted workplace type: remote",
    structureSignals: [],
    flags: [],
    reasons: [],
    caveats: [],
  };
}

test("M28: unresolved US work authorization blocks Priority A without inventing an answer", () => {
  const result = assessOpportunityFit(job({
    description: "Summer 2027 internship. Duration: 10 weeks. Currently enrolled undergraduate students are eligible. Applicants must be authorized to work in the United States. Visa sponsorship is not available.",
  }), quality(), now);

  assert.equal(result.eligibility, "compatible");
  assert.equal(result.eligibilityReviewRequired, true);
  assert.match(result.eligibilityReviewReasons.join(" "), /work-authorization|sponsorship/i);
  assert.equal(result.priority, "B");
  assert.ok(result.evidence.some((item) => item.code === "work_authorization_review"));
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.workAuthorizationManualReviewBlocksPriorityA, true);
});

test("M28: passing-out date language is real graduation-window evidence", () => {
  const result = assessOpportunityFit(job({
    title: "QAE Intern",
    description: "Bachelor's degree applicants with a passing-out date between 2023 - 2025. Full-time internship.",
  }), quality(), now);

  assert.equal(result.eligibility, "mismatch");
  assert.equal(result.priority, "parked");
  assert.ok(result.evidence.some((item) => item.code === "graduation_year" && /passing-out date/i.test(item.excerpt)));
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.passingOutGraduationParsing, true);
});

test("M28: six hours per day Monday-Friday is a thirty-hour weekly college conflict", () => {
  const result = assessOpportunityFit(job({
    description: "Remote Product Internship. Can you commit to at least 6 hours per day, Monday-Friday?",
  }), quality(), now);

  assert.equal(result.hoursPerWeek.min, 30);
  assert.equal(result.hoursPerWeek.max, 30);
  assert.equal(result.collegeCompatibility, "mismatch");
  assert.match(result.collegeReason, /30 hours\/week/i);
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.dailyScheduleParsing, true);
});
