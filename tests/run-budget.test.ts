import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunBudget,
  RUN_REQUEST_BUDGET_MS,
  RUN_RESPONSE_RESERVE_MS,
} from "../lib/scout/run-budget.ts";

test("hosted run budget preserves a response buffer below Heroku's 30 second ceiling", () => {
  assert.equal(RUN_REQUEST_BUDGET_MS, 24_000);
  assert.equal(RUN_RESPONSE_RESERVE_MS, 4_000);
  assert.ok(RUN_REQUEST_BUDGET_MS < 30_000);
});

test("bounded agent calls shrink to remaining work time and stop before the response reserve", () => {
  let now = 1_000;
  const budget = createRunBudget(() => now);
  assert.equal(budget.boundedAgentTimeout(15_000), 15_000);

  now += 15_000;
  assert.equal(budget.remainingMs(), 9_000);
  assert.equal(budget.boundedAgentTimeout(15_000), 5_000);
  assert.equal(budget.canSpend(5_500), false);
  assert.equal(budget.canSpend(4_000), true);

  now += 4_800;
  assert.equal(budget.boundedAgentTimeout(4_000), 0);
});

test("budget rejects invalid timing configuration", () => {
  assert.throws(() => createRunBudget(() => 0, 4_000, 4_000), /configuration/);
  const budget = createRunBudget(() => 0);
  assert.throws(() => budget.boundedAgentTimeout(100), /timeout cap/);
});
