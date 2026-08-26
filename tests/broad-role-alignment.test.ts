import assert from "node:assert/strict";
import test from "node:test";
import { evaluateResumeAlignment } from "../lib/scout/resume-alignment.ts";

test("generic research does not become finance evidence, while explicit pricing evidence can", () => {
  const claims = [
    {
      id: "claim-adr",
      status: "approved" as const,
      statement: "Reviewed adverse-drug-reaction data and prepared technical documentation.",
      evidence: "ADR data review and documentation artifacts.",
    },
    {
      id: "claim-price",
      status: "approved" as const,
      statement: "Conducted antibiotic price desk research.",
      evidence: "Pricing comparison and desk-research artifact.",
    },
  ];
  const result = evaluateResumeAlignment({
    title: "Financial Analyst Intern",
    description: "Support financial forecasting, pricing and market analysis.",
    location: "Mumbai, India",
  }, claims);
  const finance = result.supportingClaims.find((support) => support.theme === "Finance & economics");
  assert.deepEqual(finance?.claimIds, ["claim-price"]);
  assert.ok(!finance?.claimIds.includes("claim-adr"));
});

test("technical prototype evidence supports implementation and systems roles without claiming sole manual coding", () => {
  const result = evaluateResumeAlignment({
    title: "Implementation Analyst Intern",
    description: "Support APIs, workflow automation, systems integration and QA testing.",
    location: "Remote",
  }, [{
    id: "claim-prototype",
    status: "approved",
    statement: "Built a clinic operations prototype with product direction and AI-assisted implementation.",
    evidence: "Node.js, Express, SQLite, workflow mapping, edge cases and automated tests.",
  }]);
  assert.ok(result.matches.includes("Technical delivery"));
  assert.ok(result.matches.includes("Implementation & systems"));
  assert.deepEqual(result.supportingClaims.find((support) => support.theme === "Implementation & systems")?.claimIds, ["claim-prototype"]);
});

test("one broad prototype claim cannot inflate several matching themes into a strong evidence band", () => {
  const result = evaluateResumeAlignment({
    title: "Technical Product Operations Intern",
    description: "Work across product requirements, workflow automation, APIs, systems integration, QA testing and operational process improvement.",
    location: "Remote",
  }, [{
    id: "claim-prototype",
    status: "approved",
    statement: "Built a clinic operations prototype with product direction and AI-assisted implementation.",
    evidence: "Node.js, Express, SQLite, workflow mapping, requirements, edge cases and automated tests.",
  }]);
  assert.ok(result.matches.length >= 4);
  assert.equal(result.band, "partial");
  const distinctClaimIds = new Set(result.supportingClaims.flatMap((support) => support.claimIds));
  assert.deepEqual([...distinctClaimIds], ["claim-prototype"]);
});

test("pure software-development internships stay visible as stretch even with relevant technical evidence", () => {
  const result = evaluateResumeAlignment({
    title: "Software Engineer Intern",
    description: "Build backend services, APIs and production software with automated tests, database integrations, product requirements, workflow automation and operational process improvement.",
    location: "Remote",
  }, [
    {
      id: "claim-prototype",
      status: "approved",
      statement: "Built a clinic operations prototype with product direction and AI-assisted implementation.",
      evidence: "Node.js, Express, SQLite, workflow mapping, edge cases and automated tests.",
    },
    {
      id: "claim-scout",
      status: "approved",
      statement: "Defined Scout product requirements, safety model and prototype validation flows.",
      evidence: "Requirements, workflow and testing artifacts.",
    },
  ]);
  assert.equal(result.band, "stretch");
  assert.ok(result.matches.length >= 4);
  assert.equal(result.gaps.length, 0);
});

test("real approved evidence suppresses synthetic demo claim ids", () => {
  const result = evaluateResumeAlignment({
    id: "job-real",
    title: "Product Operations Intern",
    description: "Support product workflows and technical systems.",
    location: "Remote",
  }, [
    {
      id: "demo_claim_ops",
      status: "approved",
      statement: "Mapped product workflows and operations.",
      evidence: "LOCAL DEMO ONLY — review source documents.",
    },
    {
      id: "resume-ops",
      status: "approved",
      statement: "Mapped product workflows and operations.",
      evidence: "Approved resume artifact.",
    },
  ]);
  const ids = new Set(result.supportingClaims.flatMap((support) => support.claimIds));
  assert.ok(ids.has("resume-ops"));
  assert.ok(!ids.has("demo_claim_ops"));
  assert.equal(result.basis, "1 approved resume claim");
});
