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

const AGENT_HOST = "127.0.0.1";
const explicitAgentBaseUrl = env.SCOUT_AGENT_BASE_URL?.trim() || "";
const explicitAgentSecret = env.SCOUT_AGENT_SHARED_SECRET?.trim() || "";
if (Boolean(explicitAgentBaseUrl) !== Boolean(explicitAgentSecret)) {
  throw new Error("SCOUT_AGENT_BASE_URL and SCOUT_AGENT_SHARED_SECRET must be configured together");
}

async function freeLoopbackPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, AGENT_HOST, resolve);
  });
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  if (!port) throw new Error("Unable to reserve a local Scout agent port");
  return port;
}

function modelPreference(name) {
  const value = name.toLowerCase();
  if (value.includes("qwen") && value.includes("64k")) return 5;
  if (value.includes("qwen3.5") || value.includes("qwen3_5")) return 4;
  if (value.includes("qwen")) return 3;
  if (value.includes("llama")) return 2;
  return 1;
}

function configuredHostedFreeProviders() {
  const candidates = [
    ["NVIDIA NIM", "SCOUT_NIM_FREE_API_KEY"],
    ["Groq", "SCOUT_GROQ_FREE_API_KEY"],
    ["Gemini", "SCOUT_GEMINI_FREE_API_KEY"],
    ["Cerebras", "SCOUT_CEREBRAS_FREE_API_KEY"],
    ["OpenRouter", "SCOUT_OPENROUTER_FREE_API_KEY"],
  ];
  return candidates.flatMap(([label, key]) => env[key]?.trim() ? [label] : []);
}

async function enableLocalOllamaFallbackIfAvailable() {
  const explicitAiKeys = ["SCOUT_AI_ENDPOINT_URL", "SCOUT_AI_API_KEY", "SCOUT_AI_MODEL", "SCOUT_AI_COST_CLASS"];
  const explicitAi = explicitAiKeys.filter((key) => env[key]?.trim());
  if (explicitAi.length) {
    console.log(`Scout AI: using explicit single-provider configuration (${explicitAi.length}/${explicitAiKeys.length} required fields present); router auto-configuration skipped.`);
    return;
  }

  const hosted = configuredHostedFreeProviders();
  if (hosted.length) console.log(`Scout AI: quality router found configured free/included providers: ${hosted.join(", ")}.`);

  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(900),
    });
    if (!response.ok) throw new Error(`Ollama health returned ${response.status}`);
    const payload = await response.json();
    const names = Array.isArray(payload?.models)
      ? payload.models.map((model) => typeof model?.name === "string" ? model.name.trim() : "").filter(Boolean)
      : [];
    names.sort((left, right) => modelPreference(right) - modelPreference(left));
    const model = names[0];
    if (!model) throw new Error("No local Ollama model is installed");

    env.SCOUT_OLLAMA_ENDPOINT_URL = "http://127.0.0.1:11434/v1/chat/completions";
    env.SCOUT_OLLAMA_API_KEY = "ollama-local-dev";
    env.SCOUT_OLLAMA_MODEL = model;
    env.SCOUT_OLLAMA_JSON_MODE = "0";
    console.log(`Scout AI: local Ollama ${model} enabled as the final offline fallback; no paid AI provider was activated.`);
  } catch {
    if (!hosted.length) console.log("Scout AI: no configured free cloud provider or local Ollama detected; deterministic Scout features remain available.");
    else console.log("Scout AI: local Ollama not detected; configured free/included cloud providers remain available.");
  }
}

async function waitForAgent(baseUrl, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Scout local agent exited before becoming ready (code ${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(400) });
      if (response.ok) return;
    } catch {
      // Startup race; retry for a short bounded window.
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("Scout local agent did not become healthy within 5 seconds");
}

let agentChild = null;
if (!explicitAgentBaseUrl) {
  const port = await freeLoopbackPort();
  env.SCOUT_AGENT_BASE_URL = `http://${AGENT_HOST}:${port}`;
  env.SCOUT_AGENT_SHARED_SECRET = randomBytes(32).toString("hex");
  env.SCOUT_AGENT_ALLOW_LOOPBACK_DEV = "1";
  env.SCOUT_AGENT_HOST = AGENT_HOST;
  env.SCOUT_AGENT_PORT = String(port);
  await enableLocalOllamaFallbackIfAvailable();

  const agentServer = fileURLToPath(new URL("../agent/server.ts", import.meta.url));
  agentChild = spawn(process.execPath, ["--experimental-strip-types", agentServer], { env, stdio: "inherit" });
  agentChild.on("error", (error) => console.error("Unable to start Scout local agent:", error.message));
  await waitForAgent(env.SCOUT_AGENT_BASE_URL, agentChild);
  console.log(`Scout local agent: signed loopback service ready at ${env.SCOUT_AGENT_BASE_URL}`);
} else {
  console.log(`Scout agent: using explicitly configured service at ${explicitAgentBaseUrl}`);
}

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
let vinextChild = null;
let vinextRestartCount = 0;
let stopping = false;

function stopChild(child) {
  if (child && child.exitCode === null && !child.killed) child.kill();
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  stopChild(vinextChild);
  stopChild(agentChild);
  bridge.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 500).unref();
}

function launchVinext() {
  const child = spawn(process.execPath, [vinextCli, "dev"], { env, stdio: "inherit" });
  vinextChild = child;

  child.on("error", (error) => {
    if (child !== vinextChild || stopping) return;
    console.error("Unable to start Vinext:", error.message);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (child !== vinextChild || stopping) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    if (!signal && code === 0 && vinextRestartCount < 1) {
      vinextRestartCount += 1;
      vinextChild = null;
      console.warn(`Scout web runtime exited unexpectedly (${reason}); restarting once.`);
      setTimeout(() => {
        if (!stopping) launchVinext();
      }, 250);
      return;
    }
    console.error(`Scout web runtime stopped unexpectedly (${reason}).`);
    shutdown(signal === "SIGINT" ? 130 : (code ?? 1));
  });
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

launchVinext();

if (agentChild) {
  agentChild.on("exit", (code, signal) => {
    if (stopping || (vinextChild && vinextChild.exitCode !== null)) return;
    console.error(`Scout local agent stopped unexpectedly (${signal ?? code ?? "unknown"}).`);
    shutdown(code ?? 1);
  });
}
