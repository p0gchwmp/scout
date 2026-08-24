import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createScoutAgentClientFromBindings } from "../lib/scout/agent-runtime.ts";

test("agent runtime bindings fail closed and expose no send/submit methods", () => {
  assert.throws(() => createScoutAgentClientFromBindings({}), /not configured/);
  assert.throws(() => createScoutAgentClientFromBindings({
    SCOUT_AGENT_BASE_URL: "https://agent.example.com",
    SCOUT_AGENT_SHARED_SECRET: "bad",
  }), /64 hex/);

  const client = createScoutAgentClientFromBindings({
    SCOUT_AGENT_BASE_URL: "https://agent.example.com",
    SCOUT_AGENT_SHARED_SECRET: "a".repeat(64),
  }) as unknown as Record<string, unknown>;
  assert.equal(typeof client.discoverInternships, "function");
  assert.equal(typeof client.resolveJob, "function");
  assert.equal(typeof client.researchContacts, "function");
  assert.equal(client.sendEmail, undefined);
  assert.equal(client.submitApplication, undefined);
});

test("cloud agent control-plane routes require owner auth and same-origin mutation protection", async () => {
  for (const relative of [
    "../app/api/agent/discover/route.ts",
    "../app/api/agent/resolve/route.ts",
    "../app/api/agent/research-contacts/route.ts",
  ]) {
    const route = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(route, /requireScoutApiUser\(\)/);
    assert.match(route, /requireSameOriginMutation\(request\)/);
    assert.match(route, /createScoutAgentClientFromBindings/);
    assert.doesNotMatch(route, /sendEmail|submitApplication|drafts\.send|messages\.send/);
  }
});

test("cloud discovery persists leads without caller-supplied fetch targets", async () => {
  const route = await readFile(new URL("../app/api/agent/discover/route.ts", import.meta.url), "utf8");
  assert.match(route, /client\.discoverInternships\(\)/);
  assert.match(route, /lead:agent:\$\{lead\.provider\}/);
  assert.doesNotMatch(route, /request\.json\(\)/);
  assert.match(route, /Official immutable posting snapshot required/);
});

test("cloud resolution pins the stored lead to the agent-returned official snapshot", async () => {
  const route = await readFile(new URL("../app/api/agent/resolve/route.ts", import.meta.url), "utf8");
  assert.match(route, /client\.resolveJob\(\{ canonicalUrl: lead\.canonicalUrl \}\)/);
  assert.match(route, /db\.insert\(jobSnapshots\)/);
  assert.match(route, /contentHash: official\.contentHash/);
  assert.match(route, /source: official\.source\.provider/);
  assert.match(route, /currentSnapshotId: snapshotId/);
  assert.match(route, /isNull\(jobs\.currentSnapshotId\)/);
});

test("cloud contact research is pinned to synced job snapshot and official company source", async () => {
  const route = await readFile(new URL("../app/api/agent/research-contacts/route.ts", import.meta.url), "utf8");
  assert.match(route, /job\.currentSnapshotId/);
  assert.match(route, /job\.sourceRegistryId/);
  assert.match(route, /source\.companyDomain/);
  assert.match(route, /reviewState: "needs_review"/);
  assert.match(route, /suitability: "review"/);
  assert.match(route, /onConflictDoNothing\(\)/);
});
