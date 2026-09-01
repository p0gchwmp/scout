import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("M35 exposes one command that runs doctor then the local startup smoke", async () => {
  const [ready, packageText, guide] = await Promise.all([
    source("../scripts/scout-ready.mjs"),
    source("../package.json"),
    source("../README_LOCAL_RUN.md"),
  ]);
  const packageJson = JSON.parse(packageText) as { scripts: Record<string, string> };

  assert.equal(packageJson.scripts.ready, "node scripts/scout-ready.mjs");
  assert.match(packageJson.scripts["verify:release"], /scout-ready\.mjs --self-test/);
  assert.match(ready, /scout-doctor\.mjs/);
  assert.match(ready, /scout-smoke\.mjs/);
  assert.match(ready, /read-only doctor/);
  assert.match(ready, /full local startup smoke/);
  assert.match(ready, /Start Scout with `npm run dev`/);
  assert.doesNotMatch(ready, /--remote/);
  assert.doesNotMatch(ready, /deploy|send email|submit application/i);

  assert.match(guide, /npm run ready/);
  assert.match(guide, /npm run dev/);
  assert.match(guide, /npm run dev:demo/);
  assert.match(guide, /does not deploy Scout/i);
  assert.match(guide, /activate paid providers, send outreach, or submit applications/i);
});
