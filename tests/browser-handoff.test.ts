import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { BROWSER_HANDOFF_CAPABILITIES, createBrowserHandoffToken, verifyBrowserHandoffToken } from "../lib/scout/browser-handoff.ts";

const secret = "a".repeat(64);
const now = Date.parse("2026-08-24T10:00:00Z");

test("browser handoff token contains only task metadata and binds exact page/version", async () => {
  assert.equal(BROWSER_HANDOFF_CAPABILITIES.profileDataInToken, false);
  assert.equal(BROWSER_HANDOFF_CAPABILITIES.submitApplication, false);
  const handoff = await createBrowserHandoffToken({
    applicationId: "application-123",
    artifactVersion: 4,
    allowedUrl: "https://company.tally.so/r/apply?utm_source=test",
    secret,
    now,
    nonce: "nonce-123",
  });
  assert.doesNotMatch(handoff.token, /Ryan|email|university|claim/i);
  const verified = await verifyBrowserHandoffToken({
    token: handoff.token,
    currentUrl: "https://company.tally.so/r/apply?anything=ignored",
    secret,
    now: now + 30_000,
  });
  assert.equal(verified.applicationId, "application-123");
  assert.equal(verified.artifactVersion, 4);
  assert.equal(verified.allowedUrl, "https://company.tally.so/r/apply");
});

test("browser handoff rejects tamper, expiry, and a different application path", async () => {
  const handoff = await createBrowserHandoffToken({ applicationId: "application-123", artifactVersion: 1, allowedUrl: "https://example.com/jobs/apply", secret, now, nonce: "nonce-123" });
  await assert.rejects(() => verifyBrowserHandoffToken({ token: `${handoff.token.slice(0, -1)}0`, currentUrl: "https://example.com/jobs/apply", secret, now: now + 1_000 }), /signature|invalid/i);
  await assert.rejects(() => verifyBrowserHandoffToken({ token: handoff.token, currentUrl: "https://example.com/jobs/other", secret, now: now + 1_000 }), /different application page/i);
  await assert.rejects(() => verifyBrowserHandoffToken({ token: handoff.token, currentUrl: "https://example.com/jobs/apply", secret, now: handoff.expiresAt + 1 }), /expired/i);
});

test("extension exchange is bearer-token scoped and exposes no submission surface", async () => {
  const route = await readFile(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8");
  assert.match(route, /verifyBrowserHandoffToken/);
  assert.match(route, /artifactVersion/);
  assert.match(route, /allowedUrl/);
  assert.match(route, /access-control-allow-origin/);
  assert.match(route, /submitApplication: false/);
  assert.doesNotMatch(route, /requireScoutApiUser\(\)/);
  assert.doesNotMatch(route, /\.click\(\).*submit|requestSubmit|form\.submit|submitApplication\(/s);
});

test("browser extension never submits and separates AI drafts from verified profile answers", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  assert.match(content, /item\.verified !== true && !\(item\.aiDraft === true && item\.reviewed === true\)/);
  assert.match(content, /Needs confirmation:/);
  assert.match(content, /submitAvailable: false/);
  assert.match(content, /captcha/i);
  assert.doesNotMatch(content, /requestSubmit\(|\.submit\(|click\(\).*submit/s);
});
