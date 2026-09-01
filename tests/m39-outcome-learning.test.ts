import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildOutcomeLearning, OUTCOME_LEARNING_CAPABILITIES } from "../lib/scout/outcome-learning.ts";

const jobs = [
  { id: "p1", title: "Product Operations Intern", description: "product operations strategy" },
  { id: "p2", title: "Product Intern", description: "product research" },
  { id: "r1", title: "Research Intern", description: "economic policy research" },
  { id: "r2", title: "Policy Research Intern", description: "public policy research" },
];

const submitted = (id: string, jobId: string, status: string) => ({ id, jobId, status, submittedAt: "2026-08-30T00:00:00.000Z" });

test("M39 waits for enough explicit outcomes before learning", () => {
  const model = buildOutcomeLearning(jobs, [submitted("a", "p1", "interview"), submitted("b", "p2", "offer")]);
  assert.equal(model.active, false);
  assert.ok(model.families.every((family) => family.adjustment === 0));
});

test("M39 uses explicit positive and negative outcomes only as bounded soft nudges", () => {
  const model = buildOutcomeLearning(jobs, [
    submitted("a", "p1", "interview"),
    submitted("b", "p2", "offer"),
    submitted("c", "r1", "rejected"),
    submitted("d", "r2", "rejected"),
  ]);
  assert.equal(model.active, true);
  const product = model.families.find((family) => family.supportingApplicationIds.includes("a"))!;
  const research = model.families.find((family) => family.supportingApplicationIds.includes("c"))!;
  assert.ok(product.adjustment > 0 && product.adjustment <= 5);
  assert.ok(research.adjustment < 0 && research.adjustment >= -5);
  assert.equal(OUTCOME_LEARNING_CAPABILITIES.hardEligibilityUnaffected, true);
  assert.equal(OUTCOME_LEARNING_CAPABILITIES.automaticRoleHiding, false);
});

test("M39 treats waiting and withdrawal as neutral and ignores unsubmitted rows", () => {
  const model = buildOutcomeLearning(jobs, [
    submitted("a", "p1", "awaiting_reply"),
    submitted("b", "p2", "withdrawn"),
    submitted("c", "r1", "interview"),
    { id: "x", jobId: "r2", status: "offer", submittedAt: null },
  ]);
  assert.equal(model.totalSubmittedOutcomes, 3);
  assert.equal(OUTCOME_LEARNING_CAPABILITIES.silenceMeansNegative, false);
  assert.equal(OUTCOME_LEARNING_CAPABILITIES.withdrawnMeansNegative, false);
});

test("M39 outcomes UI explains bounded learning rather than hidden automation", async () => {
  const ui = await readFile(new URL("../app/outcomes/outcomes-client.tsx", import.meta.url), "utf8");
  assert.match(ui, /Outcome learning/);
  assert.match(ui, /soft nudge/);
  assert.match(ui, /does not read Gmail threads/);
  assert.doesNotMatch(ui, /auto(?:matically)?\s+(?:apply|send)/i);
});
