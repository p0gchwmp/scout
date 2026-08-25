import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("local bridge emits one signed source observation for every controlled board", async () => {
  const dev = await readFile(new URL("../scripts/scout-dev.mjs", import.meta.url), "utf8");
  assert.match(dev, /schemaVersion: 2/);
  assert.match(dev, /const sources = \[\]/);
  assert.match(dev, /status: "completed", internshipCount: internships\.length/);
  assert.match(dev, /status: "failed", internshipCount: 0, reason/);
  assert.match(dev, /failures\.push\(\{ slug: source\.slug/);
  assert.match(dev, /sources\.push/);
});

test("local import verifies source observations against the controlled catalog", async () => {
  const verify = await readFile(new URL("../lib/scout/local-discovery-import.ts", import.meta.url), "utf8");
  assert.match(verify, /raw\.schemaVersion !== 1 && raw\.schemaVersion !== 2/);
  assert.match(verify, /raw\.sources\.length !== discoveryCatalog\.length/);
  assert.match(verify, /Discovery source observations must be unique/);
  assert.match(verify, /Discovery failure list does not match source observations/);
  assert.match(verify, /controlledSource\(raw\.provider, raw\.slug\)/);
});

test("local import persists health rows without mutating job lifecycle from source failures", async () => {
  const route = await readFile(new URL("../app/api/lead-discovery/import/route.ts", import.meta.url), "utf8");
  assert.match(route, /idempotencyKey: `local-health:\$\{Date\.parse\(discovery\.observedAt\)\}`/);
  assert.match(route, /status: observation\.status/);
  assert.match(route, /discoveredCount: observation\.internshipCount/);
  assert.match(route, /error: observation\.reason/);
  assert.match(route, /sourceChecks/);
  assert.doesNotMatch(route, /lifecycleState:\s*"closed"/);
  assert.doesNotMatch(route, /disabled:\s*true|enabled:\s*false/);
});
