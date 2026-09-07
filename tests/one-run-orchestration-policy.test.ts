import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/agent/orchestrate/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/run/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/run/run-client.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("M17 reuses the green core runner instead of duplicating its pipeline", () => {
  assert.match(route, /POST as runCoreScout/);
  assert.match(route, /await runCoreScout\(request\)/);
});

test("M17 ecosystem search remains ephemeral while long contact crawling is deferred to bounded routes", () => {
  assert.match(route, /persistedSearchResults: false/);
  assert.match(route, /buildEcosystemOutreachSeeds/);
  assert.match(route, /normalizeEcosystemSearchResult/);
  assert.match(route, /deferredToDedicatedResearch: true/);
  assert.match(route, /Long public-contact crawling is intentionally deferred/);
  assert.doesNotMatch(route, /researchPublishedCompanyContacts/);
});

test("M17 starts bounded ecosystem discovery alongside the core run instead of stacking it afterward", () => {
  assert.match(route, /const runBudget = createRunBudget\(\)/);
  assert.match(route, /const ecosystemPromise = discoverEcosystem\(runBudget\);[\s\S]*const coreResponse = await runCoreScout\(request\);[\s\S]*const ecosystem = await ecosystemPromise/);
  assert.match(route, /provider\.searchFixedQuery\(query\.query, \{ timeoutMs \}\)/);
  assert.match(route, /orchestrationBudget/);
});

test("M17 never auto-promotes portfolio leads or performs outbound execution", () => {
  assert.match(route, /autoPromotePortfolioLead: false/);
  assert.match(route, /autoAcceptContact: false/);
  assert.match(route, /createGmailDraft: false/);
  assert.match(route, /sendEmail: false/);
  assert.match(route, /submitApplication: false/);
  assert.doesNotMatch(route, /messages\.send|drafts\.send|submitApplication\s*:\s*true|autoAcceptContact\s*:\s*true/);
});

test("M17 surfaces accepted contacts for drafting without automatically drafting", () => {
  assert.match(route, /acceptedContactsReadyForDraft/);
  assert.match(route, /autoDrafted: 0/);
  assert.match(route, /does not spend AI drafting capacity or create Gmail drafts automatically/);
});

test("M17 Run Scout workspace is owner-only, keeps hosted orchestration and guards non-JSON platform errors", () => {
  assert.match(page, /requireChatGPTUser\("\/run"\)/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(client, /requestJson<RunPayload>\(/);
  assert.match(client, /"\/api\/agent\/orchestrate"/);
  assert.match(client, /response\.text\(\)/);
  assert.match(client, /returned HTTP \$\{response\.status\} without JSON/);
  assert.doesNotMatch(client, /const payload = await response\.json\(\) as RunPayload/);
});

test("local Run Scout reuses the signed browser discovery bridge instead of weakening workerd loopback protections", () => {
  assert.match(client, /function isLoopbackBrowser\(\)/);
  assert.match(client, /if \(isLoopbackBrowser\(\)\) \{[\s\S]*await runLocalDevelopmentFallback\(\)/);
  assert.match(client, /127\.0\.0\.1:43119\/discover/);
  assert.match(client, /fetch\("\/api\/lead-discovery\/import"/);
  assert.match(client, /payload: envelope\.payload, signature: envelope\.signature/);
  assert.match(client, /fetch\("\/api\/lead-resolution", \{ method: "POST" \}\)/);
  assert.match(client, /Local safe run completed/);
  assert.match(client, /Cloud-agent-only ecosystem, AI\/contact research and automatic application-preparation stages were deliberately not represented as completed/);
  assert.doesNotMatch(client, /SCOUT_LOCAL_DISCOVERY_SECRET|SCOUT_AGENT_SHARED_SECRET/);
  assert.doesNotMatch(client, /sendEmail\(|submitApplication\(|messages\.send|drafts\.send/);
});

test("M17 Run Scout workspace is reachable from main navigation", () => {
  assert.match(home, /\["Run Scout", "\/run"\]/);
});
