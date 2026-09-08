import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("profile review is pinned to the exact updatedAt value the owner reviewed", async () => {
  const route = await readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8");

  assert.match(route, /expectedUpdatedAt\(\(raw as Record<string, unknown>\)\?\.expectedUpdatedAt\)/);
  assert.match(route, /eq\(profileEvidence\.updatedAt, payload\.expectedUpdatedAt\)/);
  assert.match(route, /Profile field changed; reload and review the exact current value before changing verification/);
  assert.match(route, /status: 409/);
});

test("every current profile-review client sends the displayed updatedAt token", async () => {
  const [dashboard, setup, voice] = await Promise.all([
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/setup/setup-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/voice/voice-client.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /expectedUpdatedAt: field\.updatedAt/);
  assert.match(setup, /expectedUpdatedAt: field\.updatedAt/);
  assert.match(voice, /expectedUpdatedAt: field\.updatedAt/);
});

test("profile review never falls back to id-only verification", async () => {
  const route = await readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /update\(profileEvidence\)[\s\S]{0,300}where\(eq\(profileEvidence\.id, payload\.id\)\)\.returning/);
});
