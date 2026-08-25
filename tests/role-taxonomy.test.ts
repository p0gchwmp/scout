import assert from "node:assert/strict";
import test from "node:test";
import { classifyRoleTaxonomy, ROLE_TAXONOMY_CAPABILITIES } from "../lib/scout/role-taxonomy.ts";
import { evaluateShortlist } from "../lib/scout/shortlist-intelligence.ts";

const now = new Date("2026-08-25T00:00:00Z");
const technicalClaims = [{
  id: "claim-systems",
  statement: "Built a Node.js, Express and SQLite clinic operations prototype with workflow mapping and automated tests.",
  evidence: "Prototype, requirements mapping, edge cases and automated test artifacts.",
  status: "approved" as const,
}];

test("role taxonomy treats analyst and technical-systems work as first-class broad-fit lanes", () => {
  const analyst = classifyRoleTaxonomy({
    title: "Data Analyst Intern",
    description: "Build dashboards and analyze healthcare product data.",
  });
  assert.equal(analyst.primaryFamily.id, "analytics");
  assert.equal(analyst.preferenceLane, "broad_fit");
  assert.ok(analyst.sectorTags.includes("Health-tech"));

  const implementation = classifyRoleTaxonomy({
    title: "Implementation Analyst Intern",
    description: "Work with APIs, integrations, workflow automation and testing.",
  });
  assert.equal(implementation.primaryFamily.id, "technical_systems");
  assert.equal(implementation.preferenceLane, "broad_fit");
});

test("finance and policy context remain available without turning policy into the role family", () => {
  const finance = classifyRoleTaxonomy({
    title: "Financial Analyst Intern",
    description: "Fintech forecasting, pricing and market analysis.",
  });
  assert.equal(finance.primaryFamily.id, "finance_economics");
  assert.ok(finance.sectorTags.includes("Fintech"));

  const policy = classifyRoleTaxonomy({
    title: "Research Intern",
    description: "Public policy and governance research with evidence synthesis.",
  });
  assert.equal(policy.primaryFamily.id, "research");
  assert.ok(policy.sectorTags.includes("Policy / governance"));
});

test("pure software development stays visible as a stretch preference rather than being excluded", () => {
  const software = classifyRoleTaxonomy({
    title: "Software Engineering Intern",
    description: "Production software engineering, APIs and distributed systems.",
  });
  assert.equal(software.primaryFamily.id, "software_development");
  assert.equal(software.preferenceLane, "software_stretch");
  assert.equal(ROLE_TAXONOMY_CAPABILITIES.softwareDevelopmentVisible, true);
  assert.equal(ROLE_TAXONOMY_CAPABILITIES.softwareDevelopmentHardExcluded, false);
});

test("equally evidenced technical-systems work outranks pure software development without hiding it", () => {
  const shared = {
    location: "Remote",
    workplaceType: "remote",
    postedAt: "2026-08-24T00:00:00Z",
    currentSnapshotId: "snapshot-1",
    eligibilityRisks: [] as string[],
  };
  const implementation = evaluateShortlist({
    ...shared,
    title: "Implementation Systems Intern",
    description: "Implement APIs, databases, workflow automation, testing and technical systems.",
  }, technicalClaims, now);
  const software = evaluateShortlist({
    ...shared,
    title: "Software Engineering Intern",
    description: "Production software engineering with APIs, databases, workflow automation and testing.",
  }, technicalClaims, now);

  assert.equal(implementation.preferenceLane, "broad_fit");
  assert.equal(software.preferenceLane, "software_stretch");
  assert.ok(implementation.score > software.score);
  assert.notEqual(software.priority, "unranked");
  assert.match(software.whyWorthYourTime, /stretch lane/i);
});
