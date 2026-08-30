import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/lead-promotion/route.ts", import.meta.url), "utf8");
const resolver = await readFile(new URL("../agent/official-resolution.ts", import.meta.url), "utf8").catch(() => "");
const client = await readFile(new URL("../app/ecosystem/ecosystem-client.tsx", import.meta.url), "utf8").catch(() => "");

test("M15 route is owner-authenticated and same-origin protected", () => {
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
});

test("M15 uses independent official ATS resolution before persistence", () => {
  assert.match(route, /resolveSearchLeadToOfficialAts/);
  assert.match(route, /createAgentSearchProvider/);
  assert.match(route, /jobSnapshots/);
  assert.match(route, /companySources/);
  assert.match(route, /searchSnippetPersisted: false/);
  assert.match(route, /originalLeadPersisted: false/);
});

test("M15 does not add send/apply/contact-accept side effects", () => {
  assert.match(route, /contactAccepted: false/);
  assert.match(route, /gmailDraftCreated: false/);
  assert.match(route, /sendEmail: false/);
  assert.match(route, /submitApplication: false/);
  assert.doesNotMatch(route, /messages\.send|drafts\.send|reviewState:\s*"accepted"/);
});

test("existing resolver itself requires official re-fetch and disallows arbitrary result fetch", () => {
  if (!resolver) return;
  assert.match(resolver, /refetchOfficialAts: true/);
  assert.match(resolver, /officialSnapshotRequiredBeforePersistence: true/);
  assert.match(resolver, /arbitraryResultPageFetch: false/);
});

test("ecosystem workspace exposes explicit promotion when M15 client is included", () => {
  if (!client) return;
  assert.match(client, /\/api\/lead-promotion/);
  assert.match(client, /Resolve & save official role/);
  assert.match(client, /Employer company/);
});
