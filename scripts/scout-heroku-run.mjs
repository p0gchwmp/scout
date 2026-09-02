import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";

const root = process.cwd();
const LOOPBACK = "127.0.0.1";
const required = [
  "SCOUT_OWNER_USER_ID",
  "SCOUT_PUBLIC_ORIGIN",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_JWT_KEY",
  "CLERK_ISSUER",
  "CLOUDFLARE_ACCOUNT_ID",
  "SCOUT_D1_DATABASE_ID",
  "SCOUT_D1_API_TOKEN",
];
const forbidden = [
  "SCOUT_LOCAL_DEV_RUNTIME",
  "SCOUT_LOCAL_DEV_AUTH",
  "SCOUT_LOCAL_DEV_USER_ID",
  "SCOUT_LOCAL_DISCOVERY_SECRET",
  "SCOUT_BROWSER_HANDOFF_SECRET",
  "SCOUT_AGENT_ALLOW_LOOPBACK_DEV",
];

function value(name) {
  return process.env[name]?.trim() ?? "";
}

if (process.env.NODE_ENV !== "production") {
  throw new Error("Scout Heroku launcher requires NODE_ENV=production");
}
if (value("SCOUT_AUTH_PROVIDER").toLowerCase() !== "clerk") {
  throw new Error("Scout Heroku launcher requires SCOUT_AUTH_PROVIDER=clerk");
}
for (const name of required) {
  if (!value(name)) throw new Error(`Scout Heroku launcher requires ${name}`);
}
for (const name of forbidden) {
  if (value(name)) throw new Error(`Scout Heroku launcher refuses production variable ${name}`);
}
if (!/^user_[A-Za-z0-9]+$/.test(value("SCOUT_OWNER_USER_ID"))) {
  throw new Error("SCOUT_OWNER_USER_ID must be the approved Clerk user id");
}

const publicOrigin = new URL(value("SCOUT_PUBLIC_ORIGIN"));
if (
  publicOrigin.protocol !== "https:"
  || publicOrigin.pathname !== "/"
  || publicOrigin.search
  || publicOrigin.hash
  || publicOrigin.username
  || publicOrigin.password
  || ["localhost", "127.0.0.1", "::1"].includes(publicOrigin.hostname.toLowerCase())
) {
  throw new Error("SCOUT_PUBLIC_ORIGIN must be the hosted HTTPS origin only");
}

const webPort = Number(process.env.PORT);
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
  throw new Error("Heroku PORT is missing or invalid");
}

async function freeLoopbackPort() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once("error", reject);
    probe.listen(0, LOOPBACK, resolvePromise);
  });
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolvePromise) => probe.close(resolvePromise));
  if (!port) throw new Error("Unable to reserve private Scout agent port");
  return port;
}

async function waitForAgent(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Scout agent exited during startup (${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Bounded startup race.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Scout private agent did not become healthy");
}

const agentPort = await freeLoopbackPort();
const sharedSecret = randomBytes(32).toString("hex");
const runtimeEnv = {
  ...process.env,
  SCOUT_RUNTIME_TARGET: "node",
  SCOUT_AGENT_BASE_URL: `http://${LOOPBACK}:${agentPort}`,
  SCOUT_AGENT_SHARED_SECRET: sharedSecret,
  SCOUT_AGENT_ALLOW_LOCAL_RUNTIME: "1",
};
delete runtimeEnv.SCOUT_AGENT_ALLOW_LOOPBACK_DEV;

const agentEnv = {
  ...runtimeEnv,
  PORT: String(agentPort),
  SCOUT_AGENT_HOST: LOOPBACK,
  SCOUT_AGENT_PORT: String(agentPort),
};
const agentServer = resolve(root, "agent", "server.ts");
const agentChild = spawn(process.execPath, ["--experimental-strip-types", agentServer], {
  cwd: root,
  env: agentEnv,
  stdio: "inherit",
});
agentChild.on("error", (error) => console.error("Unable to start Scout private agent:", error.message));
await waitForAgent(runtimeEnv.SCOUT_AGENT_BASE_URL, agentChild);
console.log(`Scout private agent ready on ${LOOPBACK}:${agentPort}.`);

const vinextCli = resolve(root, "node_modules", "vinext", "dist", "cli.js");
const webChild = spawn(process.execPath, [vinextCli, "start"], {
  cwd: root,
  env: {
    ...runtimeEnv,
    HOST: "0.0.0.0",
    PORT: String(webPort),
  },
  stdio: "inherit",
});

let stopping = false;
function stopChild(child) {
  if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
}
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  stopChild(webChild);
  stopChild(agentChild);
  setTimeout(() => process.exit(code), 750).unref();
}

webChild.on("error", (error) => {
  console.error("Unable to start Scout web runtime:", error.message);
  shutdown(1);
});
webChild.on("exit", (code, signal) => {
  if (stopping) return;
  console.error(`Scout web runtime stopped (${signal ?? code ?? "unknown"}).`);
  shutdown(code ?? 1);
});
agentChild.on("exit", (code, signal) => {
  if (stopping) return;
  console.error(`Scout private agent stopped (${signal ?? code ?? "unknown"}).`);
  shutdown(code ?? 1);
});

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
