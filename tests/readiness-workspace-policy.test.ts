import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/readiness/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/readiness/readiness-client.tsx", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const prep = await readFile(new URL("../lib/scout/application-prep.ts", import.meta.url), "utf8");

test("application readiness workspace remains owner-only", () => {
  assert.match(page, /requireChatGPTUser\("\/readiness"\)/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(worker, /"\/readiness"/);
});

test("Safe Fill unlock requires both current readiness and a ready packet", () => {
  assert.match(client, /readiness\.status === "ready" && application\?\.status === "ready_for_review"/);
  assert.match(client, /Safe Fill locked/);
  assert.match(client, /href="\/assist"/);
  assert.doesNotMatch(client, /fetch\([^\n]*send/i);
  assert.doesNotMatch(client, /fetch\([^\n]*submit/i);
});

test("application packets expose evidence completeness without enabling side effects", () => {
  assert.match(prep, /REQUIRED_APPLICATION_PROFILE_KEYS/);
  assert.match(prep, /verifiedProfileKeys/);
  assert.match(prep, /missingProfileKeys/);
  assert.match(prep, /alwaysConfirmPerApplication/);
  assert.match(prep, /externalSideEffect: false/);
  assert.match(prep, /submit: false/);
});
