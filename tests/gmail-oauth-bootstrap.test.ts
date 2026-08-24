import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Gmail OAuth bootstrap uses desktop loopback PKCE and never performs Gmail writes", async () => {
  const script = await readFile(new URL("../scripts/scout-gmail-oauth.mjs", import.meta.url), "utf8");
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /code_challenge_method", "S256"/);
  assert.match(script, /code_verifier/);
  assert.match(script, /access_type", "offline"/);
  assert.match(script, /prompt", "consent"/);
  assert.match(script, /https:\/\/www\.googleapis\.com\/auth\/gmail\.compose/);
  assert.match(script, /\.env\.scout-gmail\.local/);
  assert.match(script, /mode: 0o600/);
  assert.doesNotMatch(script, /gmail\.googleapis\.com/);
  assert.doesNotMatch(script, /drafts\/send|messages\/send|drafts\.send|messages\.send/);
});

test("Gmail OAuth bootstrap does not print the refresh-token value", async () => {
  const script = await readFile(new URL("../scripts/scout-gmail-oauth.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /console\.log\([^\n]*refreshToken/);
  assert.doesNotMatch(script, /console\.error\([^\n]*refreshToken/);
  assert.match(script, /will NOT print the refresh token/i);
});

test("Gmail draft adapter still exposes no send/update/delete capability", async () => {
  const adapter = await readFile(new URL("../agent/gmail-drafts.ts", import.meta.url), "utf8");
  assert.match(adapter, /createDraft: true/);
  assert.match(adapter, /sendDraft: false/);
  assert.match(adapter, /sendMessage: false/);
  assert.match(adapter, /updateDraft: false/);
  assert.match(adapter, /deleteDraft: false/);
  assert.doesNotMatch(adapter, /\/drafts\/send|\/messages\/send/);
});
