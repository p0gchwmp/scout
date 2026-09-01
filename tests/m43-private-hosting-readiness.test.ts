import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M43 adds a read-only hosted configuration doctor and keeps deployment explicit", async () => {
  const [doctor, packageText, guide] = await Promise.all([
    readFile(new URL("../scripts/scout-hosting-doctor.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README_PRIVATE_HOSTING.md", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(packageText) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["hosting:doctor"], "node scripts/scout-hosting-doctor.mjs");
  assert.match(pkg.scripts["verify:release"], /scout-hosting-doctor\.mjs --self-test/);
  assert.match(doctor, /SCOUT_OWNER_USER_ID is required/);
  assert.match(doctor, /SCOUT_LOCAL_DEV_AUTH/);
  assert.match(doctor, /SCOUT_AGENT_ALLOW_LOOPBACK_DEV/);
  assert.match(doctor, /public HTTPS and non-loopback/);
  assert.match(doctor, /This command does not deploy Scout/);
  assert.doesNotMatch(doctor, /wrangler\s+deploy|npm\s+run\s+deploy|child_process[^\n]*(deploy)/i);
  assert.match(guide, /does not authorize deployment/i);
  assert.match(guide, /automatic application submission/);
  assert.match(guide, /automatic email sending/);
});
