import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("review queue requires owner auth and exposes draft-only Gmail action", async () => {
  const page = await readFile(new URL("../app/review/page.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/review/review-client.tsx", import.meta.url), "utf8");
  const gmailRoute = await readFile(new URL("../app/api/agent/create-gmail-draft/route.ts", import.meta.url), "utf8");

  assert.match(page, /requireScoutPageOwner/);
  assert.match(page, /requireChatGPTUser\("\/review"\)/);
  assert.match(client, /Approve exact revision/);
  assert.match(client, /Create Gmail draft/);
  assert.match(client, /\/api\/agent\/create-gmail-draft/);
  assert.match(client, /No autonomous email send/);
  assert.match(client, /No autonomous application submit/);
  assert.doesNotMatch(client, /messages\.send|drafts\.send|submitApplication\s*:\s*true/);
  assert.match(gmailRoute, /eq\(outreachDrafts\.state, "approved"\)/);
  assert.match(gmailRoute, /safety: \{ sendEmail: false, submitApplication: false \}/);
  assert.doesNotMatch(gmailRoute, /messages\.send|drafts\.send/);
});

test("review queue requires accepted published evidence before humanized outreach", async () => {
  const client = await readFile(new URL("../app/review/review-client.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/agent/draft-outreach/auto/route.ts", import.meta.url), "utf8");

  assert.match(client, /Accept published evidence/);
  assert.match(client, /Create humanized outreach/);
  assert.match(client, /\/api\/agent\/draft-outreach\/auto/);
  assert.match(route, /eq\(contactEvidence\.reviewState, "accepted"\)/);
  assert.match(route, /contact\.jobSnapshotId/);
  assert.match(route, /eq\(candidateClaims\.status, "approved"\)/);
  assert.match(route, /evaluateResumeAlignment/);
  assert.match(route, /writing_sample/);
  assert.match(route, /writing_style_note/);
  assert.match(route, /safety: \{ sendEmail: false, submitApplication: false \}/);
  assert.doesNotMatch(route, /messages\.send|drafts\.send|submitApplication\s*:\s*true/);
});

test("review queue sends ready applications to Safe Fill instead of submitting", async () => {
  const client = await readFile(new URL("../app/review/review-client.tsx", import.meta.url), "utf8");
  const assistRoute = await readFile(new URL("../app/api/applications/browser-task/route.ts", import.meta.url), "utf8");

  assert.match(client, /Create Safe Fill handoff/);
  assert.match(client, /href="\/assist"/);
  assert.match(assistRoute, /eq\(applications\.status, "ready_for_review"\)/);
  assert.match(assistRoute, /submitApplication: false/);
  assert.match(assistRoute, /solveCaptcha: false/);
});
