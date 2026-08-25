import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { discoverLocalSource, stableLocalDiscoveryFailure } from "./scout-local-discovery.mjs";

const env = { ...process.env };
const keys = ["SCOUT_LOCAL_DEV_AUTH", "SCOUT_LOCAL_DEV_USER_ID", "SCOUT_OWNER_USER_ID"];
const configured = keys.filter((key) => typeof env[key] === "string" && env[key].trim());

// Partial or mismatched configuration remains fail-closed in buildLocalDevWorkerBindings().
if (configured.length === 0) {
  env.SCOUT_LOCAL_DEV_AUTH = "1";
  env.SCOUT_LOCAL_DEV_USER_ID = "scout-local-owner";
  env.SCOUT_OWNER_USER_ID = "scout-local-owner";
  console.log("Scout local dev auth: loopback-only owner enabled for this dev process.");
}

const browserHandoffSecret = env.SCOUT_BROWSER_HANDOFF_SECRET?.trim() || randomBytes(32).toString("hex");
if (!/^[a-f0-9]{64}$/i.test(browserHandoffSecret)) throw new Error("SCOUT_BROWSER_HANDOFF_SECRET must be 64 hex characters when configured");
env.SCOUT_BROWSER_HANDOFF_SECRET = browserHandoffSecret;
console.log("Scout browser handoff: ephemeral local signing key enabled for this dev process.");

const DISCOVERY_HOST = "127.0.0.1";
const DISCOVERY_PORT = 43119;
const DISCOVERY_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
const secret = env.SCOUT_LOCAL_DISCOVERY_SECRET?.trim() || randomBytes(32).toString("hex");
if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("SCOUT_LOCAL_DISCOVERY_SECRET must be 64 hex characters when configured");
env.SCOUT_LOCAL_DISCOVERY_SECRET = secret;

const catalogPath = fileURLToPath(new URL("../config/discovery-sources.json", import.meta.url));
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const internshipPattern = /\b(intern|internship|trainee|apprentice|co-?op)\b/i;

function relevant(job) {
  return internshipPattern.test(`${job.title}\n${job.description}`);
}

async function discoverSettledByProvider() {
  const settled = new Array(catalog.length);
  const grouped = new Map();

  catalog.forEach((source, index) => {
    const group = grouped.get(source.provider) ?? [];
    group.push({ source, index });
    grouped.set(source.provider, group);
  });

  // Providers run in parallel, but boards inside one provider are intentionally serial.
  // This mirrors the main Scout discovery safety model and avoids self-inflicted bursts.
  await Promise.all([...grouped.values()].map(async (group) => {
    for (const { source, index } of group) {
      try {
        settled[index] = { status: "fulfilled", value: { source, jobs: await discoverLocalSource(source) } };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  }));

  return settled;
}

async function discover() {
  const settled = await discoverSettledByProvider();
  const leads = [];
  const failures = [];
  const sources = [];
  settled.forEach((result, index) => {
    const source = catalog[index];
    if (result.status === "rejected") {
      const reason = stableLocalDiscoveryFailure(result.reason);
      failures.push({ slug: source.slug, company: source.company, provider: source.provider, reason });
      sources.push({ provider: source.provider, slug: source.slug, status: "failed", internshipCount: 0, reason });
      return;
    }
    const internships = result.value.jobs.filter(relevant);
    leads.push(...internships);
    sources.push({ provider: source.provider, slug: source.slug, status: "completed", internshipCount: internships.length, reason: null });
  });
  const deduped = [...new Map(leads.map((lead) => [lead.canonicalUrl, lead])).values()].slice(0, 100);
  const payload = JSON.stringify({ schemaVersion: 2, observedAt: new Date().toISOString(), leads: deduped, failures, sources });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return { payload, signature, found: deduped.length, failures: failures.length };
}

const bridge = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && DISCOVERY_ORIGINS.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.statusCode = origin && DISCOVERY_ORIGINS.has(origin) ? 204 : 403;
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.end();
    return;
  }
  if (request.method !== "GET" || request.url !== "/discover" || !origin || !DISCOVERY_ORIGINS.has(origin)) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  try {
    const result = await discover();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Discovery bridge failed" }));
  }
});

await new Promise((resolve, reject) => {
  bridge.once("error", reject);
  bridge.listen(DISCOVERY_PORT, DISCOVERY_HOST, resolve);
});
console.log(`Scout discovery bridge: http://${DISCOVERY_HOST}:${DISCOVERY_PORT}/discover`);

const vinextCli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const child = spawn(process.execPath, [vinextCli, "dev"], { env, stdio: "inherit" });
child.on("error", (error) => {
  console.error("Unable to start Vinext:", error.message);
  bridge.close();
  process.exit(1);
});
child.on("exit", (code, signal) => {
  bridge.close();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
