import assert from "node:assert/strict";
import test from "node:test";
import { consolidateOpportunityLeads, OPPORTUNITY_QUALITY_CAPABILITIES } from "../lib/scout/opportunity-quality.ts";

type Lead = Parameters<typeof consolidateOpportunityLeads>[0][number];

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    provider: "search_index",
    canonicalUrl: "https://www.linkedin.com/jobs/view/123",
    company: "Acme Technologies Pvt Ltd",
    title: "Product Operations Intern",
    sourceUrl: "https://www.linkedin.com/jobs/view/123",
    focus: "product operations",
    location: "Bengaluru, India",
    postedAt: "2026-08-20T00:00:00Z",
    platformId: "linkedin",
    nextStep: "Resolve to official evidence",
    ...overrides,
  };
}

const now = new Date("2026-08-25T00:00:00Z");

test("duplicate intelligence prefers a controlled official ATS over a job-board copy", () => {
  const result = consolidateOpportunityLeads([
    lead(),
    lead({
      provider: "lever",
      canonicalUrl: "https://jobs.lever.co/acme/official-123",
      sourceUrl: "https://jobs.lever.co/acme",
      platformId: "lever",
      company: "Acme Technologies",
      title: "Product Operations Internship",
    }),
  ], now);

  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].provider, "lever");
  assert.equal(result.leads[0].qualityTier, "high");
  assert.equal(result.leads[0].duplicateCount, 1);
  assert.ok(result.leads[0].provenanceUrls.some((url) => url.includes("linkedin.com/jobs/view/123")));
  assert.ok(result.leads[0].provenanceUrls.some((url) => url.includes("jobs.lever.co/acme/official-123")));
  assert.equal(result.summary.duplicatesCollapsed, 1);
});

test("same title in two known cities stays as two opportunities", () => {
  const result = consolidateOpportunityLeads([
    lead({ location: "Bengaluru, India" }),
    lead({ canonicalUrl: "https://www.linkedin.com/jobs/view/456", sourceUrl: "https://www.linkedin.com/jobs/view/456", location: "Mumbai, India" }),
  ], now);
  assert.equal(result.leads.length, 2);
  assert.equal(result.summary.duplicatesCollapsed, 0);
});

test("different roles at the same company are never merged", () => {
  const result = consolidateOpportunityLeads([
    lead({ title: "Product Operations Intern" }),
    lead({ canonicalUrl: "https://www.linkedin.com/jobs/view/789", sourceUrl: "https://www.linkedin.com/jobs/view/789", title: "Business Analyst Intern" }),
  ], now);
  assert.equal(result.leads.length, 2);
});

test("tracking-only URL differences collapse as exact duplicates", () => {
  const result = consolidateOpportunityLeads([
    lead({ canonicalUrl: "https://jobs.example.com/role/1?utm_source=linkedin", sourceUrl: "https://jobs.example.com/role/1?utm_source=linkedin", platformId: "company" }),
    lead({ canonicalUrl: "https://jobs.example.com/role/1?utm_medium=social", sourceUrl: "https://jobs.example.com/role/1?utm_medium=social", platformId: "company" }),
  ], now);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].duplicateCount, 1);
});

test("clearly senior search noise and year-old search results are suppressed without hiding controlled ATS roles", () => {
  const result = consolidateOpportunityLeads([
    lead({ title: "Senior Product Manager", canonicalUrl: "https://www.linkedin.com/jobs/view/senior", sourceUrl: "https://www.linkedin.com/jobs/view/senior" }),
    lead({ title: "Business Analyst", postedAt: "2025-01-01T00:00:00Z", canonicalUrl: "https://www.linkedin.com/jobs/view/stale", sourceUrl: "https://www.linkedin.com/jobs/view/stale" }),
    lead({ provider: "greenhouse", platformId: "greenhouse", title: "Software Engineering Intern", company: "Acme", canonicalUrl: "https://job-boards.greenhouse.io/acme/jobs/10", sourceUrl: "https://job-boards.greenhouse.io/acme", postedAt: "2025-01-01T00:00:00Z" }),
  ], now);

  assert.equal(result.summary.suppressedLowSignal, 2);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].provider, "greenhouse");
});

test("associate and junior roles stay visible even when a manager keyword is present", () => {
  const result = consolidateOpportunityLeads([
    lead({ title: "Associate Product Manager", canonicalUrl: "https://www.linkedin.com/jobs/view/apm", sourceUrl: "https://www.linkedin.com/jobs/view/apm" }),
    lead({ title: "Junior Program Manager", canonicalUrl: "https://www.linkedin.com/jobs/view/junior", sourceUrl: "https://www.linkedin.com/jobs/view/junior" }),
  ], now);
  assert.equal(result.leads.length, 2);
  assert.equal(result.summary.suppressedLowSignal, 0);
});

test("forms and unresolved generic leads remain visible but low-signal rather than auto-rejected", () => {
  const result = consolidateOpportunityLeads([
    lead({ platformId: "tally", company: "Unresolved Tally lead", title: "Internship application form", canonicalUrl: "https://tally.so/r/example", sourceUrl: "https://tally.so/r/example", location: "" }),
  ], now);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].qualityTier, "low_signal");
  assert.equal(OPPORTUNITY_QUALITY_CAPABILITIES.autoRejectOpportunity, false);
  assert.equal(OPPORTUNITY_QUALITY_CAPABILITIES.geographyBias, false);
});
