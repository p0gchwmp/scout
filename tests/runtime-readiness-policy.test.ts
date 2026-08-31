import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("../app/api/runtime-readiness/route.ts", import.meta.url);
const helperUrl = new URL("../lib/scout/runtime-readiness.ts", import.meta.url);
const setupPageUrl = new URL("../app/setup/page.tsx", import.meta.url);
const setupPanelUrl = new URL("../app/setup/runtime-preflight-panel.tsx", import.meta.url);

test("runtime readiness endpoint is owner-gated, GET-only, read-only, and zero-network", async () => {
  const [route, helper] = await Promise.all([readFile(routeUrl, "utf8"), readFile(helperUrl, "utf8")]);
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /export async function GET\(\)/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /fetch\s*\(/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(route, /createGmailDraft|createOrReuseGmailDraft|createAgentAiProvider|createAgentSearchProvider/);
  assert.match(route, /sqlite_master/);
  assert.match(route, /cache-control/);

  for (const table of ["company_sources", "sync_runs", "jobs", "job_snapshots", "contact_evidence", "candidate_claims", "outreach_drafts", "outreach_draft_revisions", "applications", "profile_evidence"]) {
    assert.match(route, new RegExp(`"${table}"`));
  }
  for (const trigger of ["job_snapshots_immutable_update", "job_snapshots_immutable_delete", "candidate_claims_approved_immutable_update", "candidate_claims_approved_immutable_delete", "outreach_revisions_immutable_update", "outreach_revisions_immutable_delete"]) {
    assert.match(route, new RegExp(`"${trigger}"`));
  }
  assert.match(route, /SELECT 1 AS ok/);
});

test("runtime readiness policy keeps demo operations out of hosted API", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.doesNotMatch(route, /scout-demo-db/);
  assert.doesNotMatch(route, /seed/i);
  assert.doesNotMatch(route, /reset/i);
  assert.doesNotMatch(route, /child_process|exec\s*\(|spawn\s*\(/);
});

test("Start Here surfaces the runtime preflight without becoming a configuration editor", async () => {
  const [page, panel] = await Promise.all([readFile(setupPageUrl, "utf8"), readFile(setupPanelUrl, "utf8")]);
  assert.match(page, /RuntimePreflightPanel/);
  assert.match(panel, /fetch\("\/api\/runtime-readiness"/);
  assert.match(panel, /0 · RUNTIME PREFLIGHT/);
  assert.match(panel, /No provider was contacted/);
  assert.match(panel, /Application submit: disabled/);
  assert.match(panel, /Email send: disabled/);
  assert.doesNotMatch(panel, /SCOUT_(?:AI|SEARCH|AGENT|GMAIL|BROWSER)_[A-Z0-9_]+/);
});
