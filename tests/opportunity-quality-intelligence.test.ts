import assert from "node:assert/strict";
import test from "node:test";
import {
  assessOpportunityQuality,
  OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES,
  type OpportunityQualityJob,
  type OpportunityQualitySource,
} from "../lib/scout/opportunity-quality-intelligence.ts";

const now = new Date("2026-08-25T00:00:00Z");

function job(overrides: Partial<OpportunityQualityJob> = {}): OpportunityQualityJob {
  return {
    company: "Acme",
    title: "Business Analyst Intern",
    description: "Paid internship with a stipend of ₹20,000/month. Duration: 6 months. Work on analytics projects with a mentor and present deliverables to cross-functional teams.",
    location: "Bengaluru, India",
    workplaceType: "hybrid",
    source: "lever",
    canonicalUrl: "https://jobs.lever.co/acme/role-1",
    sourceRegistryId: "source-acme",
    currentSnapshotId: "snapshot-acme",
    postedAt: "2026-08-20T00:00:00Z",
    lastSeenAt: "2026-08-25T00:00:00Z",
    lifecycleState: "active",
    ...overrides,
  };
}

function source(overrides: Partial<OpportunityQualitySource> = {}): OpportunityQualitySource {
  return {
    id: "source-acme",
    provider: "lever",
    companyName: "Acme",
    companyDomain: "acme.example",
    careersUrl: "https://jobs.lever.co/acme",
    registered: true,
    enabled: true,
    health: { state: "healthy", label: "Healthy", reason: "Recent successful check" },
    ...overrides,
  };
}

test("strong official evidence extracts only explicitly published internship details", () => {
  const result = assessOpportunityQuality(job(), source(), now);
  assert.equal(result.tier, "strong_evidence");
  assert.equal(result.officialSnapshot, true);
  assert.equal(result.registeredSource, true);
  assert.equal(result.companyDomain, "acme.example");
  assert.equal(result.compensation.status, "explicit_paid");
  assert.match(result.compensation.text ?? "", /20,000|stipend/i);
  assert.match(result.duration ?? "", /6 months/i);
  assert.equal(result.arrangement, "hybrid");
  assert.ok(result.structureSignals.some((signal) => /mentor/i.test(signal)));
});

test("missing compensation remains unknown rather than becoming unpaid", () => {
  const result = assessOpportunityQuality(job({
    description: "Internship working on analytics projects, dashboards and business recommendations with a mentor.",
  }), source(), now);
  assert.equal(result.compensation.status, "not_published");
  assert.ok(result.caveats.some((item) => /does not infer paid or unpaid/i.test(item)));
  assert.equal(result.flags.some((flag) => flag.code === "unpaid"), false);
});

test("currency, month and remote words need opportunity context before extraction", () => {
  const result = assessOpportunityQuality(job({
    workplaceType: "unspecified",
    description: "Analyze a ₹1 billion market, compare 6 months of historical data, and study remote monitoring products for hospitals.",
  }), source(), now);
  assert.equal(result.compensation.status, "not_published");
  assert.equal(result.duration, null);
  assert.equal(result.arrangement, "unspecified");
});

test("actual pay-rate context is recognized without treating employer-paid costs as compensation", () => {
  const payRate = assessOpportunityQuality(job({ description: "Pay rate: $20/hour. Internship duration: 12 weeks. Work remotely with a mentor." }), source(), now);
  assert.equal(payRate.compensation.status, "explicit_paid");
  assert.match(payRate.compensation.text ?? "", /\$20|pay rate/i);

  const employerCosts = assessOpportunityQuality(job({ description: "We pay for training and travel costs. The internship includes mentorship and a supervised project." }), source(), now);
  assert.equal(employerCosts.compensation.status, "not_published");
  assert.equal(employerCosts.flags.some((flag) => flag.code === "candidate_payment"), false);
});

test("explicit unpaid status is a caution but never an automatic rejection", () => {
  const result = assessOpportunityQuality(job({ description: "This internship is unpaid. You will work on a supervised market-research project. Internship duration: 3 months." }), source(), now);
  assert.equal(result.compensation.status, "explicit_unpaid");
  assert.ok(result.flags.some((flag) => flag.code === "unpaid" && flag.severity === "caution"));
  assert.notEqual(result.tier, "strong_evidence");
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.autoRejectOpportunity, false);
});

test("candidate fees, commission-only pay and unpaid trial work are high-severity red flags", () => {
  const result = assessOpportunityQuality(job({
    description: "Pay a registration fee of ₹999 to join. Compensation is commission-only after an unpaid trial week.",
  }), source(), now);
  assert.equal(result.tier, "red_flag");
  assert.ok(result.flags.some((flag) => flag.code === "candidate_payment" && flag.severity === "high"));
  assert.ok(result.flags.some((flag) => flag.code === "commission_only" && flag.severity === "high"));
  assert.ok(result.flags.some((flag) => flag.code === "unpaid_trial" && flag.severity === "high"));
});

test("anti-scam fee language is not itself treated as a candidate-payment red flag", () => {
  for (const description of [
    "We do not charge any application fee. This is a paid internship with mentorship and project work.",
    "There is no registration fee for applicants. The internship includes supervised project work.",
    "Candidates never pay a training fee to participate in this internship.",
  ]) {
    const result = assessOpportunityQuality(job({ description }), source(), now);
    assert.equal(result.flags.some((flag) => flag.code === "candidate_payment"), false, description);
  }
  const actualFee = assessOpportunityQuality(job({ description: "A registration fee of ₹999 is required to join this internship." }), source(), now);
  assert.ok(actualFee.flags.some((flag) => flag.code === "candidate_payment" && flag.severity === "high"));
});

test("source-health trouble creates a review caution, not a legitimacy verdict", () => {
  const result = assessOpportunityQuality(job(), source({ health: { state: "degraded", label: "Degraded", reason: "ATS timed out" } }), now);
  assert.ok(result.flags.some((flag) => flag.code === "source_health"));
  assert.ok(result.caveats.some((item) => /does not certify.*legitimate/i.test(item)));
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.inferCompanyLegitimacy, false);
});

test("unresolved thin leads stay visible as low-signal instead of being called scams", () => {
  const result = assessOpportunityQuality(job({
    description: "Internship opportunity.",
    source: "lead:linkedin",
    sourceRegistryId: null,
    currentSnapshotId: null,
    workplaceType: "unspecified",
    postedAt: null,
  }), null, now);
  assert.equal(result.tier, "low_signal");
  assert.equal(result.officialSnapshot, false);
  assert.ok(result.flags.some((flag) => flag.code === "thin_description"));
  assert.ok(result.caveats.some((item) => /does not imply.*illegitimate/i.test(item)));
});

test("old active official postings are review cautions without geography or fit-score behavior", () => {
  const result = assessOpportunityQuality(job({ postedAt: "2026-03-01T00:00:00Z" }), source(), now);
  assert.ok(result.flags.some((flag) => flag.code === "old_posting"));
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.modifyResumeFitScore, false);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.geographyBias, false);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.persistedEvidenceOnly, true);
});
