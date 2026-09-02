import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Heroku build uses the Node target and an explicit supervised web process", async () => {
  const [packageJson, buildScript, procfile, vite, launcher] = await Promise.all([
    source("package.json"),
    source("scripts/scout-node-build.mjs"),
    source("Procfile"),
    source("vite.config.ts"),
    source("scripts/scout-heroku-run.mjs"),
  ]);
  assert.match(packageJson, /"build:node": "node scripts\/scout-node-build\.mjs"/);
  assert.match(packageJson, /"heroku-postbuild": "npm run build:node"/);
  assert.equal(procfile.trim(), "web: node scripts/scout-heroku-run.mjs");
  assert.match(buildScript, /SCOUT_RUNTIME_TARGET: "node"/);
  assert.match(vite, /isNodeTarget/);
  assert.match(vite, /"cloudflare:workers"/);
  assert.match(vite, /nodeAgentRuntime/);
  assert.match(launcher, /SCOUT_AGENT_ALLOW_LOCAL_RUNTIME: "1"/);
  assert.match(launcher, /SCOUT_AGENT_HOST: LOOPBACK/);
  assert.match(launcher, /randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(launcher, /delete runtimeEnv\.SCOUT_AGENT_ALLOW_LOOPBACK_DEV/);
});

test("Node agent adapter permits only explicit 127.0.0.1 service origins", async () => {
  const adapter = await source("lib/scout/node-agent-runtime.ts");
  assert.match(adapter, /url\.hostname === "127\.0\.0\.1"/);
  assert.match(adapter, /url\.protocol === "http:"/);
  assert.match(adapter, /SCOUT_AGENT_ALLOW_LOCAL_RUNTIME/);
  assert.match(adapter, /allowLoopbackDev: allowPrivateNodeAgent/);
  assert.doesNotMatch(adapter, /hostname === "localhost"/);
});

test("Clerk proxy rebuilds owner identity only after verified session", async () => {
  const proxy = await source("proxy.ts");
  assert.match(proxy, /verifyClerkSession/);
  assert.match(proxy, /headers\.delete\("oai-authenticated-user-id"\)/);
  assert.match(proxy, /headers\.delete\("x-scout-owner-user-id"\)/);
  assert.match(proxy, /headers\.set\("oai-authenticated-user-id", session\.userId\)/);
  assert.match(proxy, /session\.userId !== ownerId/);
  assert.match(proxy, /Scout owner is not configured/);
  assert.doesNotMatch(proxy, /SCOUT_LOCAL_DEV_AUTH/);
});

test("hosted sign-in is owner-oriented and does not expose a Clerk secret", async () => {
  const [signIn, page, auth] = await Promise.all([
    source("app/sign-in/[[...sign-in]]/sign-in-client.tsx"),
    source("app/sign-in/[[...sign-in]]/page.tsx"),
    source("lib/scout/clerk-auth.ts"),
  ]);
  assert.match(signIn, /withSignUp: false/);
  assert.match(page, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  assert.match(auth, /CLERK_JWT_KEY/);
  assert.doesNotMatch(`${signIn}\n${page}\n${auth}`, /CLERK_SECRET_KEY/);
});

test("portable runtime keeps send and application submission outside deployment config", async () => {
  const [proxy, procfile, buildScript, launcher] = await Promise.all([
    source("proxy.ts"),
    source("Procfile"),
    source("scripts/scout-node-build.mjs"),
    source("scripts/scout-heroku-run.mjs"),
  ]);
  const combined = `${proxy}\n${procfile}\n${buildScript}\n${launcher}`;
  assert.doesNotMatch(combined, /send[_-]?email/i);
  assert.doesNotMatch(combined, /submit[_-]?application/i);
  assert.doesNotMatch(combined, /SCOUT_ALLOW_METERED_AI\s*[:=]\s*["']?1/);
});
