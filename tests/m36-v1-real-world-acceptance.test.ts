import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFormFields, draftableApplicationQuestions, reviewApplicationFormConstraints } from "../lib/scout/form-intelligence.ts";
import { assessOpportunityFit } from "../lib/scout/opportunity-fit.ts";
import { scoutV1AcceptanceIssues } from "../lib/scout/v1-acceptance.ts";

const quality = {
  tier: "good",
  officialSnapshot: true,
  registeredSource: true,
} as unknown as Parameters<typeof assessOpportunityFit>[1];

function job(title: string, description: string, location = "India / Remote") {
  return {
    id: `fixture:${title}`,
    company: "Acceptance Fixture",
    title,
    description,
    location,
    workplaceType: "remote",
    source: "official_fixture",
    sourceRegistryId: "fixture-source",
    canonicalUrl: "https://example.com/jobs/fixture",
    currentSnapshotId: "snapshot-fixture",
    postedAt: "2026-08-28T00:00:00.000Z",
  } as unknown as Parameters<typeof assessOpportunityFit>[0];
}

test("M36 real-world acceptance keeps high-workload college conflicts out of Priority A", () => {
  const result = assessOpportunityFit(
    job("Revenue & Operations Intern", "Currently enrolled undergraduate. Must commit at least 6 hours per day, Monday-Friday."),
    quality,
    new Date("2026-09-01T00:00:00.000Z"),
  );
  assert.equal(result.hoursPerWeek.min, 30);
  assert.equal(result.collegeCompatibility, "mismatch");
  assert.notEqual(result.priority, "A");
});

test("M36 real-world acceptance parks an explicit passing-out-year mismatch", () => {
  const result = assessOpportunityFit(
    job("QAE Intern", "Bachelor's degree in computer science; passing out date between 2023 - 2025."),
    quality,
    new Date("2026-09-01T00:00:00.000Z"),
  );
  assert.equal(result.eligibility, "mismatch");
  assert.equal(result.priority, "parked");
});

test("M36 real-world acceptance requires manual work-authorization review", () => {
  const result = assessOpportunityFit(
    job("Operations Intern", "Currently enrolled Bachelor's student. Applicants must be legally authorized to work in the U.S.; sponsorship is not available."),
    quality,
    new Date("2026-09-01T00:00:00.000Z"),
  );
  assert.equal(result.eligibilityReviewRequired, true);
  assert.notEqual(result.priority, "A");
  assert.ok(result.evidence.some((item) => item.code === "work_authorization_review"));
});

test("M36 visible form constraints remain manual and never enter claim drafting", () => {
  const analysis = analyzeFormFields([
    { id: "auth", label: "Are you legally authorized to work in the United States?", controlKind: "select", inputType: "select", maxLength: null, required: true },
    { id: "hours", label: "Can you commit at least 6 hours per day Monday-Friday?", controlKind: "select", inputType: "select", maxLength: null, required: true },
    { id: "semester", label: "What is your current semester?", controlKind: "input", inputType: "text", maxLength: 80, required: true },
    { id: "start", label: "What is your earliest start date?", controlKind: "input", inputType: "text", maxLength: 80, required: true },
  ]);
  const review = reviewApplicationFormConstraints(analysis.fields);
  assert.equal(review.required, true);
  assert.deepEqual(review.counts, {
    work_authorization: 1,
    schedule_commitment: 1,
    graduation_or_degree: 1,
    availability: 1,
  });
  assert.deepEqual(draftableApplicationQuestions(analysis.fields), []);
});

test("M36 Scout V1 acceptance manifest has no unresolved safety contract issues", () => {
  assert.deepEqual(scoutV1AcceptanceIssues(), []);
});
