import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const automaticDiscoveryRoutes = [
  "../app/api/agent/discover/route.ts",
  "../app/api/agent/run/route.ts",
  "../app/api/lead-discovery/route.ts",
  "../app/api/lead-discovery/import/route.ts",
  "../app/api/lead-promotion/route.ts",
] as const;

test("automatic discovery and resolution paths do not auto-save jobs", async () => {
  for (const relativePath of automaticDiscoveryRoutes) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /state:\s*["']shortlisted["']/);
    assert.doesNotMatch(source, /state:\s*["']saved["']/);
  }
});

test("manual internship intake may still capture a lead as saved", async () => {
  const source = await readFile(new URL("../app/api/intake/route.ts", import.meta.url), "utf8");
  assert.match(source, /state:\s*["']saved["']/);
  assert.match(source, /requireScoutApiUser/);
  assert.match(source, /requireSameOriginMutation/);
});

test("jobs listing applies the one-time legacy saved-state cleanup after owner auth", async () => {
  const route = await readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser/);
  assert.match(route, /ensureDiscoverySavedStateBackfill/);

  const backfill = await readFile(new URL("../lib/scout/discovery-saved-state.ts", import.meta.url), "utf8");
  assert.match(backfill, /scout_runtime_migrations/);
  assert.match(backfill, /UPDATE jobs[\s\S]*SET state = 'shortlisted'[\s\S]*WHERE state = 'saved'/);
  assert.match(backfill, /contact_evidence[\s\S]*review_state = 'accepted'/);
  assert.match(backfill, /outreach_drafts/);
  assert.match(backfill, /INSERT OR IGNORE INTO scout_runtime_migrations/);
});

test("the explicit jobs mutation remains the only dashboard path that can save a role", async () => {
  const route = await readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /set\(\{ state: payload\.state \}\)/);
  assert.match(route, /requireSameOriginMutation/);

  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /updateJob\(job\.id,\s*["']saved["']\)/);
});
