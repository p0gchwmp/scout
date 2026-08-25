import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("agent run reuses duplicate opportunities and upgrades only unresolved records to official leads", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");

  assert.match(route, /sameOpportunityIdentity/);
  assert.match(route, /const knownJobs = await db\.select\(\)\.from\(jobs\)/);
  assert.match(route, /duplicatesReused/);
  assert.match(route, /unresolvedUpgradedToOfficialLead/);
  assert.match(route, /!found\.currentSnapshotId && lead\.provider !== "search_index"/);
  assert.match(route, /preferred the official ATS lead/);
  assert.doesNotMatch(route, /db\.delete\(jobSnapshots\)/);
  assert.doesNotMatch(route, /db\.delete\(jobs\)/);
});

test("duplicate persistence does not add any application submit or email send surface", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /sendEmail: false/);
  assert.match(route, /submitApplication: false/);
  assert.doesNotMatch(route, /fetch\([^)]*submit/i);
  assert.doesNotMatch(route, /sendMail|sendEmail\(/i);
});
