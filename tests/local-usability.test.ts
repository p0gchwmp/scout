import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("npm dev bootstraps a fresh local D1 without touching remote or ambiguous legacy data", async () => {
  const [runner, packageText] = await Promise.all([
    source("../scripts/scout-local-run.mjs"),
    source("../package.json"),
  ]);
  const packageJson = JSON.parse(packageText) as { scripts: Record<string, string> };
  const migrationArgsBody = runner.match(/export function buildMigrationArgs\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.equal(packageJson.scripts.dev, "node scripts/scout-local-run.mjs");
  assert.equal(packageJson.scripts["dev:demo"], "node scripts/scout-local-run.mjs --demo");
  assert.equal(packageJson.scripts["dev:raw"], "node scripts/scout-dev.mjs");
  assert.match(packageJson.scripts["verify:release"], /scout-local-run\.mjs --self-test/);

  assert.match(migrationArgsBody, /"wrangler", "d1", "migrations", "apply"/);
  assert.match(migrationArgsBody, /"--local"/);
  assert.match(migrationArgsBody, /"--persist-to"/);
  assert.doesNotMatch(migrationArgsBody, /"--remote"/);
  assert.match(runner, /WRANGLER_SEND_METRICS: "false"/);
  assert.match(runner, /name = 'd1_migrations'/);
  assert.match(runner, /legacy\/manual database detected; leaving it untouched/);
  assert.match(runner, /Expected at most one local Scout D1 database/);
  assert.match(runner, /Refusing Scout local bootstrap with NODE_ENV=production/);
  assert.match(runner, /CF_PAGES/);
  assert.match(runner, /WORKERS_CI/);
});

test("npm dev auto-boots a signed loopback agent without enabling paid/external services", async () => {
  const [devScript, agentServer] = await Promise.all([
    source("../scripts/scout-dev.mjs"),
    source("../agent/server.ts"),
  ]);

  assert.match(devScript, /SCOUT_AGENT_SHARED_SECRET = randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(devScript, /SCOUT_AGENT_BASE_URL = `http:\/\/\$\{AGENT_HOST\}:\$\{port\}`/);
  assert.match(devScript, /SCOUT_AGENT_ALLOW_LOOPBACK_DEV = "1"/);
  assert.match(devScript, /SCOUT_AGENT_HOST = AGENT_HOST/);
  assert.match(devScript, /agent\/server\.ts/);
  assert.match(devScript, /waitForAgent/);
  assert.match(agentServer, /server\.listen\(port, host/);
  assert.match(agentServer, /"127\.0\.0\.1"/);

  assert.match(devScript, /SCOUT_NIM_FREE_API_KEY/);
  assert.match(devScript, /SCOUT_GROQ_FREE_API_KEY/);
  assert.match(devScript, /SCOUT_GEMINI_FREE_API_KEY/);
  assert.match(devScript, /SCOUT_OLLAMA_ENDPOINT_URL = "http:\/\/127\.0\.0\.1:11434\/v1\/chat\/completions"/);
  assert.match(devScript, /final offline fallback/);
  assert.doesNotMatch(devScript, /SCOUT_ALLOW_METERED_AI\s*=\s*"1"/);
  assert.doesNotMatch(devScript, /SCOUT_SEARCH_PROVIDER\s*=/);
  assert.doesNotMatch(devScript, /SCOUT_SEARCH_API_KEY\s*=/);
  assert.doesNotMatch(devScript, /gmail.*oauth/i);
});

test("Start Here is owner-only and starter evidence stays unverified or draft until explicit review", async () => {
  const [page, client, worker] = await Promise.all([
    source("../app/setup/page.tsx"),
    source("../app/setup/setup-client.tsx"),
    source("../worker/index.ts"),
  ]);

  assert.match(page, /requireChatGPTUser\("\/setup"\)/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(worker, /OWNER_PAGE_PATHS\.add\("\/setup"\)/);
  assert.match(client, /Save missing profile basics/);
  assert.match(client, /added as drafts only/);
  assert.match(client, /fieldwork was planned\/resuming rather than completed/);
  assert.match(client, /does not autonomously submit applications or send outreach/);
  assert.doesNotMatch(client, /action:\s*"approve"/);
  assert.doesNotMatch(client, /SCOUT_ALLOW_METERED/);
});

test("legacy Dashboard actions are accepted only through validated compatibility paths", async () => {
  const [claims, profile, contacts, applications, outreach] = await Promise.all([
    source("../app/api/claims/route.ts"),
    source("../app/api/profile/route.ts"),
    source("../app/api/contacts/route.ts"),
    source("../app/api/applications/route.ts"),
    source("../app/api/outreach/route.ts"),
  ]);

  assert.match(claims, /if \(isMutation\(raw\)\) return mutateClaim\(raw\)/);
  assert.match(claims, /parseClaimMutationPayload/);
  assert.match(profile, /dashboardReviewPayload/);
  assert.match(profile, /parseProfileReviewPayload/);
  assert.match(contacts, /if \(looksLikeReview\(raw\)\) return reviewContact\(raw\)/);
  assert.match(contacts, /parseContactReviewPayload/);
  assert.match(applications, /refreshRequest/);
  assert.match(applications, /artifactVersion !== expectedApplication\.expectedVersion/);
  assert.match(outreach, /withVerifiedCandidateName/);
  assert.match(outreach, /eq\(profileEvidence\.verified, true\)/);
});
