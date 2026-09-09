import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new profile rows use a deterministic id per profile kind", async () => {
  const route = await readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8");
  assert.match(route, /function profileRecordId\(kind: string\)/);
  assert.match(route, /id: profileRecordId\(payload\.kind\)/);
  assert.match(route, /onConflictDoNothing\(\)\.returning\(\)/);
});

test("profile upsert fails closed if duplicate evidence already exists", async () => {
  const route = await readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8");
  assert.match(route, /where\(eq\(profileEvidence\.kind, payload\.kind\)\)\.limit\(2\)/);
  assert.match(route, /existingRows\.length > 1/);
  assert.match(route, /repair the duplicate evidence before editing or verifying it/);
  assert.match(route, /status: 409/);
});

test("profile review also fails closed when a kind is ambiguous", async () => {
  const route = await readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8");
  assert.match(route, /where\(eq\(profileEvidence\.kind, current\.kind\)\)\.limit\(2\)/);
  assert.match(route, /sameKindRows\.length > 1/);
  assert.match(route, /return duplicateProfileError\(\)/);
});

test("concurrent creation cannot silently produce a second profile row", async () => {
  const route = await readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8");
  assert.match(route, /Profile field was created concurrently; reload the current evidence before editing/);
  assert.doesNotMatch(route, /id: crypto\.randomUUID\(\), \.\.\.payload, verified: false/);
});

test("resume import uses deterministic profile ids and conflict-safe creation", async () => {
  const route = await readFile(new URL("../app/api/resume-import/route.ts", import.meta.url), "utf8");
  assert.match(route, /function profileRecordId\(kind: string\)/);
  assert.match(route, /id: profileRecordId\(incoming\.kind\)/);
  assert.match(route, /onConflictDoNothing\(\)/);
  assert.match(route, /insertedProfileRows\.length !== newProfileRows\.length/);
  assert.doesNotMatch(route, /id: crypto\.randomUUID\(\),\s*\.\.\.incoming/);
});

test("resume import fails closed when existing profile kinds are duplicated", async () => {
  const route = await readFile(new URL("../app/api/resume-import/route.ts", import.meta.url), "utf8");
  assert.match(route, /const duplicateKinds =/);
  assert.match(route, /currentProfile\.filter\(\(field\) => field\.kind === kind\)\.length > 1/);
  assert.match(route, /repair the duplicate evidence before importing/);
  assert.match(route, /conflictingKinds: duplicateKinds/);
});

test("resume import does not overwrite a profile row verified concurrently", async () => {
  const route = await readFile(new URL("../app/api/resume-import/route.ts", import.meta.url), "utf8");
  assert.match(route, /eq\(profileEvidence\.verified, false\)/);
  assert.match(route, /if \(!field\)/);
  assert.match(route, /Profile evidence changed concurrently/);
});
