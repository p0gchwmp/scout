import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("setup never infers Ryan's current location from origin or project context", async () => {
  const setup = await source("app/setup/setup-client.tsx");
  assert.doesNotMatch(setup, /claim:\s*"Jammu, India"/);
  assert.match(setup, /const \[currentLocation, setCurrentLocation\] = useState\(""\)/);
  assert.match(setup, /kind: "current_location", claim: currentLocation\.trim\(\)/);
  assert.match(setup, /Entered by Ryan in Scout Start Here\. Verify this exact current location before reuse\./);
  assert.match(setup, /Current location, email, and the approved resume reference are intentionally not guessed/);
});

test("explicit setup inputs may update unverified evidence but never overwrite verified profile facts", async () => {
  const setup = await source("app/setup/setup-client.tsx");
  assert.match(setup, /const existing = profileByKind\.get\(field\.kind\)/);
  assert.match(setup, /if \(existing\?\.verified\) continue/);
  assert.match(setup, /saved or updated as unverified/);
});

test("starter academic wording remains review-bound rather than self-certifying", async () => {
  const setup = await source("app/setup/setup-client.tsx");
  assert.doesNotMatch(setup, /Ryan-confirmed official degree wording/);
  assert.doesNotMatch(setup, /Ryan-confirmed degree path/);
  assert.match(setup, /Verify the exact official degree wording before application use/);
  assert.match(setup, /Verify against official academic documentation before approval/);
});
