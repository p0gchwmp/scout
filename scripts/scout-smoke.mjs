import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const smokeUrl = "http://127.0.0.1:3000/setup";
const timeoutMs = Number.parseInt(process.env.SCOUT_SMOKE_TIMEOUT_MS ?? "45000", 10);

function enabled(value) {
  if (value === undefined || value === null) return false;
  return !["", "0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function assertLocalOnly(env = process.env) {
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error("Refusing Scout smoke verification with NODE_ENV=production");
  }
  for (const key of ["CF_PAGES", "WORKERS_CI"]) {
    if (enabled(env[key])) throw new Error(`Refusing Scout smoke verification when ${key} is enabled`);
  }
  const target = new URL(smokeUrl);
  if (!new Set(["127.0.0.1", "localhost"]).has(target.hostname)) {
    throw new Error("Scout smoke target must stay on loopback");
  }
}

async function waitForWeb(child) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Scout dev runtime exited before web readiness (code ${child.exitCode})`);
    try {
      const response = await fetch(smokeUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(900),
        headers: { accept: "text/html" },
      });
      lastStatus = response.status;
      if (response.ok) {
        const html = await response.text();
        if (html.trim()) return;
      }
    } catch {
      // Expected while Vinext is compiling/binding its local listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Scout web did not become ready at ${smokeUrl} within ${timeoutMs}ms${lastStatus ? ` (last HTTP ${lastStatus})` : ""}`);
}

async function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  if (child.exitCode !== null) return;
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  if (child.exitCode === null && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function selfTest() {
  assertLocalOnly({});
  if (timeoutMs < 5000) throw new Error("SCOUT_SMOKE_TIMEOUT_MS must be at least 5000ms");
  if (new URL(smokeUrl).hostname !== "127.0.0.1") throw new Error("Smoke URL self-test failed");
  console.log("Scout local smoke self-test: OK (loopback-only startup probe)." );
}

const allowed = new Set(["--self-test"]);
for (const argument of process.argv.slice(2)) {
  if (!allowed.has(argument)) throw new Error(`Unknown Scout smoke option: ${argument}`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

assertLocalOnly();
const localRun = fileURLToPath(new URL("./scout-local-run.mjs", import.meta.url));
const child = spawn(process.execPath, [localRun], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  detached: process.platform !== "win32",
});

let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  await stopProcessTree(child);
}

process.on("SIGINT", () => void cleanup().finally(() => process.exit(130)));
process.on("SIGTERM", () => void cleanup().finally(() => process.exit(143)));

try {
  await waitForWeb(child);
  console.log(`Scout local smoke: PASS (${smokeUrl} returned an authenticated local page).`);
} finally {
  await cleanup();
}
