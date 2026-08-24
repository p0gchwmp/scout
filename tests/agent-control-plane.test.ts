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
  assert.equal(typeof client.classifyContacts, "function");
  assert.equal(typeof client.draftOutreach, "function");
  assert.equal(client.sendEmail, undefined);
  assert.equal(client.submitApplication, undefined);
});

test("cloud agent control-plane routes require owner auth and same-origin mutation protection", async () => {
  for (const relative of [
    "../app/api/agent/discover/route.ts",
    "../app/api/agent/resolve/route.ts",
    "../app/api/agent/research-contacts/route.ts",
    "../app/api/agent/classify-contacts/route.ts",
    "../app/api/agent/draft-outreach/route.ts",
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

test("cloud resolution pins stored lead evidence to the agent-returned official snapshot", async () => {
  const route = await readFile(new URL("../app/api/agent/resolve/route.ts", import.meta.url), "utf8");
  assert.match(route, /const resolveInput = \{ canonicalUrl: lead\.canonicalUrl, company: lead\.company, title: lead\.title \}/);
  assert.match(route, /client\.resolveJob\(resolveInput\)/);
  assert.match(route, /db\.insert\(jobSnapshots\)/);
  assert.match(route, /contentHash: official\.contentHash/);
  assert.match(route, /source: official\.source\.provider/);
  assert.match(route, /currentSnapshotId: snapshotId/);
  assert.match(route, /isNull\(jobs\.currentSnapshotId\)/);
  assert.match(route, /unresolvedDomain\(registered\.companyDomain\) && !unresolvedDomain\(official\.source\.companyDomain\)/);
  assert.match(route, /eq\(companySources\.companyDomain, registered\.companyDomain\)/);
  assert.match(route, /contactResearchReady: !unresolvedDomain\(source\.companyDomain\)/);
});

test("cloud contact research requires a verified domain and preserves the verified careers seed", async () => {
  const route = await readFile(new URL("../app/api/agent/research-contacts/route.ts", import.meta.url), "utf8");
  assert.match(route, /job\.currentSnapshotId/);
  assert.match(route, /job\.sourceRegistryId/);
  assert.match(route, /function unresolvedDomain/);
  assert.match(route, /value\.endsWith\("\.invalid"\)/);
  assert.match(route, /A verified official company domain is required/);
  assert.match(route, /companyDomain: source\.companyDomain/);
  assert.match(route, /careersUrl: source\.careersUrl/);
  assert.match(route, /sourceType: candidate\.sourceType/);
  assert.match(route, /reviewState: "needs_review"/);
  assert.match(route, /suitability: "review"/);
  assert.match(route, /onConflictDoNothing\(\)/);
});

test("AI contact classification changes recommendation fields but never human review state", async () => {
  const route = await readFile(new URL("../app/api/agent/classify-contacts/route.ts", import.meta.url), "utf8");
  assert.match(route, /eq\(contactEvidence\.reviewState, "needs_review"\)/);
  assert.match(route, /client\.classifyContacts/);
  assert.match(route, /suitabilityReason/);
  assert.doesNotMatch(route, /reviewState:\s*classification/);
  assert.doesNotMatch(route, /reviewState:\s*"accepted"/);
  assert.doesNotMatch(route, /reviewState:\s*"rejected"/);
});

test("AI outreach is rebuilt from DB-pinned accepted evidence and approved claims", async () => {
  const route = await readFile(new URL("../app/api/agent/draft-outreach/route.ts", import.meta.url), "utf8");
  assert.match(route, /eq\(contactEvidence\.reviewState, "accepted"\)/);
  assert.match(route, /claims\.some\(\(claim\) => claim\.status !== "approved"\)/);
  assert.match(route, /buildAiOutreachEnvelope/);
  assert.match(route, /client\.draftOutreach\(envelope\)/);
  assert.match(route, /claimIds: ai\.usedClaimIds/);
  assert.match(route, /state: "draft"/);
  assert.match(route, /hashDraftBody/);
});
