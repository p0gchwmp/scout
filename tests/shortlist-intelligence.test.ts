import assert from "node:assert/strict";
import test from "node:test";
import { evaluateShortlist } from "../lib/scout/shortlist-intelligence.ts";

const claims = [
  { id: "claim-product", statement: "Mapped clinic workflows and product requirements for an operations prototype.", evidence: "Product requirements and workflow artifact", status: "approved" as const },
  { id: "claim-research", statement: "Reviewed adverse-drug-reaction data and prepared technical documentation.", evidence: "GMC Jammu work evidence", status: "approved" as const },
  { id: "claim-draft", statement: "Expert SQL analyst", evidence: "Unverified draft", status: "draft" as const },
];

const now = new Date("2026-08-25T00:00:00Z");

test("shortlist intelligence transparently prefers India over a scoped foreign posting", () => {
  const india = evaluateShortlist({
    title: "Product Operations Intern",
    description: "Support product workflows, research, documentation and operations.",
    location: "Bengaluru, India",
    workplaceType: "hybrid",
    postedAt: "2026-08-23T00:00:00Z",
    lastSeenAt: "2026-08-25T00:00:00Z",
    currentSnapshotId: "snapshot-1",
    eligibilityRisks: [],
  }, claims, now);

  const london = evaluateShortlist({
    title: "Product Operations Intern",
    description: "Support product workflows, research, documentation and operations.",
    location: "London, United Kingdom",
    workplaceType: "on-site",
    postedAt: "2026-08-23T00:00:00Z",
    lastSeenAt: "2026-08-25T00:00:00Z",
    currentSnapshotId: "snapshot-2",
    eligibilityRisks: [],
  }, claims, now);

  assert.equal(india.locationContext, "India");
  assert.equal(india.targetGeographyLane, "india");
  assert.equal(london.locationContext, "Global");
  assert.equal(london.targetGeographyLane, "scoped_elsewhere");
  assert.ok(india.score > london.score);
  assert.ok(london.priority === "consider" || london.priority === "low");
  assert.ok(india.supportingClaimIds.includes("claim-product"));
  assert.ok(!india.supportingClaimIds.includes("claim-draft"));
  assert.match(london.whyWorthYourTime, /target-geography preference/i);
});

test("shortlist intelligence lowers priority for explicit gaps and stale postings", () => {
  const strong = evaluateShortlist({
    title: "Operations Research Intern",
    description: "Research, data review, documentation and operations support.",
    location: "Remote",
    workplaceType: "remote",
    postedAt: "2026-08-24T00:00:00Z",
    currentSnapshotId: "snapshot-current",
    eligibilityRisks: [],
  }, claims, now);

  const risky = evaluateShortlist({
    title: "Operations Research Intern",
    description: "Research and operations support. Driver's licence required.",
    location: "Toronto, Canada",
    workplaceType: "on-site",
    postedAt: "2026-03-01T00:00:00Z",
    currentSnapshotId: "snapshot-old",
    eligibilityRisks: ["Local work authorization may be required"],
  }, claims, now);

  assert.ok(strong.score > risky.score);
  assert.ok(risky.gaps.some((gap) => /Driver's licence/.test(gap)));
  assert.ok(risky.gaps.includes("Local work authorization may be required"));
  assert.equal(strong.locationContext, "Remote");
  assert.equal(strong.targetGeographyLane, "open_remote");
});

test("shortlist intelligence stays unranked without approved claims", () => {
  const result = evaluateShortlist({
    title: "Finance Intern",
    description: "Financial analysis internship",
    location: "Singapore",
    postedAt: "2026-08-25T00:00:00Z",
    currentSnapshotId: "snapshot-1",
  }, claims.map((claim) => ({ ...claim, status: "draft" as const })), now);

  assert.equal(result.priority, "unranked");
  assert.equal(result.label, "Needs approved claims");
  assert.match(result.whyWorthYourTime, /Approve candidate claims/);
});
