import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROWSER_HANDOFF_LOCAL_SECRET_ENV,
  BROWSER_HANDOFF_RUNTIME_SECRET_ENV,
  browserHandoffSecretCandidate,
  browserHandoffSecretIsValid,
  resolveBrowserHandoffSecret,
} from "../lib/scout/browser-handoff-runtime.ts";

const first = "a".repeat(64);
const second = "b".repeat(64);

test("browser handoff runtime key is strict, prefers hosted runtime, and keeps local fallback", () => {
  assert.equal(BROWSER_HANDOFF_RUNTIME_SECRET_ENV, "SCOUT_BROWSER_HANDOFF_RUNTIME_SECRET");
  assert.equal(BROWSER_HANDOFF_LOCAL_SECRET_ENV, "SCOUT_BROWSER_HANDOFF_SECRET");
  assert.equal(browserHandoffSecretIsValid(first), true);
  assert.equal(browserHandoffSecretIsValid("short"), false);
  assert.equal(browserHandoffSecretCandidate({ SCOUT_BROWSER_HANDOFF_SECRET: first }), first);
  assert.equal(resolveBrowserHandoffSecret({ SCOUT_BROWSER_HANDOFF_SECRET: first }), first);
  assert.equal(resolveBrowserHandoffSecret({
    SCOUT_BROWSER_HANDOFF_RUNTIME_SECRET: second,
    SCOUT_BROWSER_HANDOFF_SECRET: first,
  }), second);
  assert.throws(() => resolveBrowserHandoffSecret({}), /not configured/i);
  assert.throws(() => resolveBrowserHandoffSecret({ SCOUT_BROWSER_HANDOFF_RUNTIME_SECRET: "short" }), /not configured/i);
});

test("Heroku creates the browser handoff key internally and refuses external injection", async () => {
  const [launcher, route, exchange, doctor] = await Promise.all([
    readFile(new URL("../scripts/scout-heroku-run.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/applications/browser-task/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/scout-hosting-doctor.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(launcher, /const browserHandoffSecret = randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(launcher, /"SCOUT_BROWSER_HANDOFF_SECRET"/);
  assert.match(launcher, /"SCOUT_BROWSER_HANDOFF_RUNTIME_SECRET"/);
  assert.match(launcher, /SCOUT_BROWSER_HANDOFF_RUNTIME_SECRET: browserHandoffSecret/);
  assert.match(launcher, /SCOUT_BROWSER_HANDOFF_SECRET: browserHandoffSecret/);
  assert.match(launcher, /delete agentEnv\.SCOUT_BROWSER_HANDOFF_RUNTIME_SECRET/);
  assert.match(launcher, /delete agentEnv\.SCOUT_BROWSER_HANDOFF_SECRET/);

  assert.match(route, /resolveBrowserHandoffSecret/);
  assert.match(exchange, /SCOUT_BROWSER_HANDOFF_SECRET/);
  assert.match(doctor, /SCOUT_BROWSER_HANDOFF_SECRET/);
  assert.doesNotMatch(launcher, /submitApplication\s*:\s*true|sendOutreach\s*:\s*true/);
});
