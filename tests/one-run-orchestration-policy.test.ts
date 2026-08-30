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

test("M17 ecosystem search remains ephemeral while curated official targets may be seeded", () => {
  assert.match(route, /persistedSearchResults: false/);
  assert.match(route, /buildEcosystemOutreachSeeds/);
  assert.match(route, /normalizeEcosystemSearchResult/);
  assert.match(route, /reviewState: "needs_review"/);
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

test("M17 Run Scout workspace is owner-only and calls the orchestration endpoint", () => {
  assert.match(page, /requireChatGPTUser\("\/run"\)/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(client, /fetch\("\/api\/agent\/orchestrate", \{ method: "POST" \}\)/);
});

test("M17 Run Scout workspace is reachable from main navigation", () => {
  assert.match(home, /\["Run Scout", "\/run"\]/);
});
