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
