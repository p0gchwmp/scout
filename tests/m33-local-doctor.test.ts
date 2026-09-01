import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("M33 exposes a read-only local doctor before npm dev", async () => {
  const [doctor, packageText] = await Promise.all([
    source("../scripts/scout-doctor.mjs"),
    source("../package.json"),
  ]);
  const packageJson = JSON.parse(packageText) as { scripts: Record<string, string> };

  assert.equal(packageJson.scripts.doctor, "node scripts/scout-doctor.mjs");
  assert.match(packageJson.scripts["verify:release"], /scout-doctor\.mjs --self-test/);
  assert.match(doctor, /const MIN_NODE = \[22, 13, 0\]/);
  assert.match(doctor, /SCOUT_LOCAL_DEV_AUTH/);
  assert.match(doctor, /SCOUT_LOCAL_DEV_USER_ID/);
  assert.match(doctor, /SCOUT_OWNER_USER_ID/);
  assert.match(doctor, /NODE_ENV/);
  assert.match(doctor, /CF_PAGES/);
  assert.match(doctor, /WORKERS_CI/);
  assert.match(doctor, /name = 'd1_migrations'/);
  assert.match(doctor, /M32 will preserve it rather than replay migrations/);
  assert.match(doctor, /const REQUIRED_PORTS = \[3000, 43119\]/);
  assert.match(doctor, /No free cloud AI key detected; deterministic Scout features still run/);
  assert.match(doctor, /Next: npm run dev/);

  assert.doesNotMatch(doctor, /writeFile|rmSync|unlinkSync|rmdirSync/);
  assert.doesNotMatch(doctor, /--remote/);
  assert.doesNotMatch(doctor, /deploy|send email|submit application/i);
});
