import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release gate runs tests lint migrations generation build and git hygiene", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["verify:release"] ?? "";
  const expected = [
    "npm test",
    "npm run lint",
    "python tests/migration-smoke.py",
    "npm run db:generate",
    "git diff --exit-code",
    "npm run build",
    "git diff --check",
    "git status --short --branch",
    "git diff --stat",
  ];
  let cursor = -1;
  for (const token of expected) {
    const next = script.indexOf(token);
    assert.ok(next > cursor, `release gate must contain ${token} in order`);
    cursor = next;
  }
});

test("readiness endpoint is owner-only read-only and checks the D1 jobs schema", async () => {
  const route = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /getDb\(\)\.select\(\{ id: jobs\.id \}\)\.from\(jobs\)\.limit\(1\)/);
  assert.match(route, /applicationSubmission: false/);
  assert.match(route, /emailSending: false/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)\b/);
  assert.doesNotMatch(route, /requireSameOriginMutation/);
});

test("app error boundary offers recovery without creating an external side effect", async () => {
  const boundary = await readFile(new URL("../app/error.tsx", import.meta.url), "utf8");
  assert.match(boundary, /"use client"/);
  assert.match(boundary, /onClick=\{reset\}/);
  assert.match(boundary, /href="\/api\/health"/);
  assert.match(boundary, /No application submission or email sending was triggered/);
  assert.doesNotMatch(boundary, /fetch\(/);
});
