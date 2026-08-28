import assert from "node:assert/strict";
import test from "node:test";
import { assessOpportunityFit, OPPORTUNITY_FIT_CAPABILITIES, type OpportunityPriority } from "../lib/scout/opportunity-fit.ts";
import type { OpportunityQualityAssessment, OpportunityQualityJob } from "../lib/scout/opportunity-quality-intelligence.ts";

const now = new Date("2026-08-29T00:00:00Z");

function job(overrides: Partial<OpportunityQualityJob> = {}): OpportunityQualityJob {
  return {
    company: "Acme",
    title: "Product Intern",
    description: "Work with the product team on research and operations projects.",
    location: "India",
    workplaceType: "remote",
    source: "greenhouse",
    canonicalUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    sourceRegistryId: "source-acme",
    currentSnapshotId: "snapshot-acme",
    postedAt: "2026-08-20T00:00:00Z",
    lifecycleState: "active",
    ...overrides,
  };
}

function quality(overrides: Partial<OpportunityQualityAssessment> = {}): OpportunityQualityAssessment {
  return {
    score: 80,
    tier: "strong_evidence",
    label: "Strong opportunity evidence",
    evidenceLabel: "Official evidence bound",
    officialSnapshot: true,
    registeredSource: true,
    companyDomain: "acme.example",
    careersUrl: "https://acme.example/careers",
    provider: "greenhouse",
    compensation: { status: "not_published", text: null },
    duration: null,
    arrangement: "remote",
    arrangementEvidence: "Persisted workplace type: remote",
    structureSignals: [],
    flags: [],
    reasons: [],
    caveats: [],
    ...overrides,
  };
}

function expectPriority(actual: OpportunityPriority, expected: OpportunityPriority) {
  assert.equal(actual, expected);
}

test("exact Summer 2027 dates inside 21 May–31 July become Priority A for a core role", () => {
  const result = assessOpportunityFit(job({
    description: "Summer 2027 internship. Internship duration: 10 weeks. Program runs from May 24, 2027 to July 30, 2027. Currently enrolled undergraduate students are eligible.",
  }), quality(), now);
  assert.equal(result.summer2027, "exact");
  assert.equal(result.timingLane, "summer_2027");
  assert.equal(result.roleFit, "strong");
  assert.equal(result.eligibility, "compatible");
  expectPriority(result.priority, "A");
  assert.equal(result.dateWindow.start, "2027-05-24");
  assert.equal(result.dateWindow.end, "2027-07-30");
  assert.ok(result.evidence.some((item) => item.code === "date_window" && /May 24, 2027 to July 30, 2027/i.test(item.excerpt)));
});

test("Summer 2027 with a ten-week duration but no exact dates is compatible, not exact", () => {
  const result = assessOpportunityFit(job({ description: "Summer 2027 Product Internship. Duration: 10 weeks. Work on product research." }), quality(), now);
  assert.equal(result.summer2027, "compatible");
  assert.equal(result.dateWindow.start, null);
  assert.match(result.summerReason, /exact dates still need review/i);
});

test("four-to-six month commitments are Summer 2027 mismatches and are parked without another proven timing lane", () => {
  for (const duration of ["4 months", "6 months"]) {
    const result = assessOpportunityFit(job({ description: `Internship duration: ${duration}. Full-time commitment required.` }), quality(), now);
    assert.equal(result.summer2027, "mismatch");
    assert.equal(result.collegeCompatibility, "mismatch");
    expectPriority(result.priority, "parked");
  }
});

test("remote alone never proves alongside-college compatibility", () => {
  const result = assessOpportunityFit(job({ workplaceType: "remote", description: "Remote Product Internship working with product teams." }), quality(), now);
  assert.equal(result.collegeCompatibility, "unknown");
  assert.match(result.collegeReason, /Remote\/location evidence alone is not enough/i);
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.remoteAloneImpliesCollegeCompatibility, false);
});

test("published part-time flexible scheduling supports the college-compatible-now lane", () => {
  const result = assessOpportunityFit(job({
    description: "Part-time internship, 15-20 hours per week, with flexible hours that can work around your classes.",
  }), quality(), now);
  assert.equal(result.collegeCompatibility, "compatible");
  assert.equal(result.timingLane, "college_compatible_now");
  assert.equal(result.hoursPerWeek.min, 15);
  assert.equal(result.hoursPerWeek.max, 20);
  expectPriority(result.priority, "A");
  assert.ok(result.evidence.some((item) => item.code === "hours"));
});

test("full-time or fixed US business hours are explicit college mismatches", () => {
  const fullTime = assessOpportunityFit(job({ description: "This is a full-time internship at 40 hours per week." }), quality(), now);
  assert.equal(fullTime.collegeCompatibility, "mismatch");

  const fixedUs = assessOpportunityFit(job({ description: "Candidates must work US Eastern business hours during the internship." }), quality(), now);
  assert.equal(fixedUs.collegeCompatibility, "mismatch");
  assert.match(fixedUs.collegeReason, /US business-hour/i);
});

test("pure software-engineering roles remain visible as Stretch / Priority C", () => {
  const result = assessOpportunityFit(job({
    title: "Software Engineer Intern",
    description: "Part-time internship, 20 hours per week, flexible schedule.",
  }), quality(), now);
  assert.equal(result.roleFit, "stretch");
  expectPriority(result.priority, "C");
});

test("graduate-degree, seniority, and multi-year experience requirements are hard eligibility mismatches", () => {
  const graduate = assessOpportunityFit(job({ description: "MBA required. Product strategy responsibilities." }), quality(), now);
  assert.equal(graduate.eligibility, "mismatch");
  expectPriority(graduate.priority, "parked");

  const experience = assessOpportunityFit(job({ description: "Minimum 3+ years relevant experience required for this internship." }), quality(), now);
  assert.equal(experience.eligibility, "mismatch");

  const senior = assessOpportunityFit(job({ title: "Senior Product Manager", description: "Lead product strategy." }), quality(), now);
  assert.equal(senior.eligibility, "mismatch");
});

test("published graduation windows distinguish compatible 2028/2029 pathways from exclusions", () => {
  const compatible = assessOpportunityFit(job({ description: "Candidates graduating 2028-2029 are eligible for this internship." }), quality(), now);
  assert.equal(compatible.eligibility, "compatible");
  assert.ok(compatible.evidence.some((item) => item.code === "graduation_year"));

  const mismatch = assessOpportunityFit(job({ description: "Applicants must have an expected graduation 2026 to 2027." }), quality(), now);
  assert.equal(mismatch.eligibility, "mismatch");
  expectPriority(mismatch.priority, "parked");
});

test("stale postings are parked while missing dates stay unknown rather than mismatched", () => {
  const stale = assessOpportunityFit(job({ postedAt: "2026-01-01T00:00:00Z", description: "Part-time flexible Product Internship." }), quality(), now);
  assert.equal(stale.freshness.status, "stale");
  expectPriority(stale.priority, "parked");

  const unknown = assessOpportunityFit(job({ postedAt: null, description: "Remote Product Internship." }), quality(), now);
  assert.equal(unknown.summer2027, "unknown");
  assert.equal(unknown.collegeCompatibility, "unknown");
  assert.equal(unknown.eligibility, "unknown");
  assert.ok(unknown.unknowns.length >= 3);
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.missingEvidenceMeansMismatch, false);
});

test("quality red flags park an opportunity without auto-rejecting it", () => {
  const result = assessOpportunityFit(job({ description: "Part-time Product Internship." }), quality({ tier: "red_flag" }), now);
  expectPriority(result.priority, "parked");
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.autoRejectOpportunity, false);
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.submitApplication, false);
  assert.equal(OPPORTUNITY_FIT_CAPABILITIES.sendEmail, false);
});

test("month words without internship-duration context do not become scheduling evidence", () => {
  const result = assessOpportunityFit(job({
    description: "Analyze 6 months of historical sales data and compare remote monitoring products.",
  }), quality(), now);
  assert.equal(result.duration.text, null);
  assert.equal(result.duration.weeks, null);
  assert.equal(result.summer2027, "unknown");
});

test("part-time or flexible language alone remains unknown until workload/schedule evidence is sufficient", () => {
  const partTimeOnly = assessOpportunityFit(job({ description: "This is a part-time Product Internship." }), quality(), now);
  assert.equal(partTimeOnly.collegeCompatibility, "unknown");
  const flexibleOnly = assessOpportunityFit(job({ description: "This Product Internship offers flexible hours." }), quality(), now);
  assert.equal(flexibleOnly.collegeCompatibility, "unknown");
});
