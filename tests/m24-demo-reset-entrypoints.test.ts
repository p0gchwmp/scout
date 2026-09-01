import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const safe = readFileSync("scripts/scout-demo-reset.mjs", "utf8");
const all = readFileSync("scripts/scout-demo-reset-all.mjs", "utf8");
const policy = readFileSync("scripts/scout-demo-reset-policy.mjs", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("default demo reset is demo-only and requires its own confirmation", () => {
  assert.match(safe, /resetDemoRowsOnly/);
  assert.match(safe, /--confirm-demo-reset/);
  assert.match(safe, /non-demo local rows are preserved/);
  assert.equal(pkg.scripts?.["scout:demo:reset"], "node scripts/scout-demo-reset.mjs");
  assert.equal(pkg.scripts?.["scout:demo:workflow:reset"], "node scripts/scout-demo-reset.mjs");
});

test("full local wipe remains available behind dual confirmation", () => {
  assert.match(all, /--confirm-local-reset/);
  assert.match(all, /--allow-all-local-data/);
  assert.match(all, /resetAllLocalData/);
  assert.equal(pkg.scripts?.["scout:demo:reset:all"], "node scripts/scout-demo-reset-all.mjs");
});

test("M24 entrypoints reuse local-only environment and DB guards", () => {
  for (const source of [safe, all]) {
    assert.match(source, /assertSafeLocalDemoEnvironment/);
    assert.match(source, /resolveLocalD1Database/);
    assert.match(source, /assertScoutSchema/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /node:child_process/);
    assert.doesNotMatch(source, /--remote/);
  }
  assert.match(policy, /DEMO_ID_GLOB = "demo_\*"/);
});
