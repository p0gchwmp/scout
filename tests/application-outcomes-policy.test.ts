import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/application-outcomes/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/outcomes/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/outcomes/outcomes-client.tsx", import.meta.url), "utf8");

test("M16 outcomes workspace remains owner-only", () => {
  assert.match(page, /requireChatGPTUser\("\/outcomes"\)/);
  assert.match(page, /requireScoutPageOwner/);
});

test("M16 mutation route requires owner auth and same-origin mutation", () => {
  assert.match(route, /requireScoutApiUser/);
  assert.match(route, /requireSameOriginMutation/);
  assert.match(route, /expectedArtifactVersion/);
});

test("M16 only records manual state and explicit follow-up dates", () => {
  assert.match(route, /set_outcome/);
  assert.match(route, /set_follow_up/);
  assert.match(client, /My follow-up date \(optional\)/);
  assert.match(client, /does not read Gmail threads/);
});

test("M16 adds no send, submit or recruiter-response inference", () => {
  assert.doesNotMatch(route, /messages\.send|drafts\.send|submitApplication\s*:\s*true|sendEmail\s*:\s*true/);
  assert.match(route, /sendEmail:\s*false/);
  assert.match(route, /submitApplication:\s*false/);
  assert.match(client, /never sends follow-ups automatically/);
});
