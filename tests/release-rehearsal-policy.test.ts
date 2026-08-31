import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("release rehearsal is part of the release test path and stays safety-focused", async () => {
  const packageJson = JSON.parse(await source("package.json")) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  assert.match(scripts.test ?? "", /release-rehearsal\.test\.mjs/);
  assert.equal(
    scripts["scout:release:rehearsal"],
    "npm run build && node --test tests/release-rehearsal.test.mjs",
  );

  const rehearsal = await source("tests/release-rehearsal.test.mjs");
  for (const expected of [
    "/api/health",
    "/api/runtime-readiness",
    "/api/claims",
    "/api/applications",
    "/api/applications/submit",
    "/api/agent/send-gmail",
    "Cross-origin mutation denied",
    "applicationSubmission: false",
    "emailSending: false",
    "captchaSolving: false",
    "privateContactScraping: false",
  ]) assert.match(rehearsal, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(rehearsal, /Release rehearsal blocked external fetch/);
  assert.match(rehearsal, /assert\.deepEqual\(externalFetches, \[\]\)/);
  assert.doesNotMatch(rehearsal, /sendMail|sendMessage|submitApplication|createGmailDraft\s*\(/);
});
