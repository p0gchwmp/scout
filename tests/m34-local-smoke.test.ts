import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("M34 adds a bounded loopback-only full startup smoke check", async () => {
  const [smoke, packageText, viteConfig] = await Promise.all([
    source("../scripts/scout-smoke.mjs"),
    source("../package.json"),
    source("../vite.config.ts"),
  ]);
  const packageJson = JSON.parse(packageText) as { scripts: Record<string, string> };

  assert.equal(packageJson.scripts.smoke, "node scripts/scout-smoke.mjs");
  assert.match(packageJson.scripts["verify:release"], /scout-smoke\.mjs --self-test/);
  assert.match(packageJson.scripts["verify:release"], /scout-smoke\.mjs/);
  assert.match(smoke, /http:\/\/127\.0\.0\.1:3000\/setup/);
  assert.match(smoke, /SCOUT_SMOKE_TIMEOUT_MS/);
  assert.match(smoke, /process\.platform === "win32" \? 240000 : 90000/);
  assert.match(smoke, /AbortSignal\.timeout\(probeTimeoutMs\)/);
  assert.doesNotMatch(smoke, /45000/);
  assert.match(smoke, /Refusing Scout smoke verification with NODE_ENV=production/);
  assert.match(smoke, /CF_PAGES/);
  assert.match(smoke, /WORKERS_CI/);
  assert.match(smoke, /taskkill/);
  assert.match(smoke, /process\.kill\(-child\.pid, "SIGTERM"\)/);
  assert.match(smoke, /Scout local smoke: PASS/);
  assert.match(viteConfig, /host: "127\.0\.0\.1"/);
  assert.match(viteConfig, /port: 3000/);
  assert.match(viteConfig, /strictPort: true/);
  assert.doesNotMatch(viteConfig, /host: "0\.0\.0\.0"/);
  assert.doesNotMatch(smoke, /--remote/);
  assert.doesNotMatch(smoke, /deploy|send email|submit application/i);
});
