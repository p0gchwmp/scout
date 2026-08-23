import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

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

const DISCOVERY_HOST = "127.0.0.1";
const DISCOVERY_PORT = 43119;
const DISCOVERY_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
const secret = env.SCOUT_LOCAL_DISCOVERY_SECRET?.trim() || randomBytes(32).toString("hex");
if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("SCOUT_LOCAL_DISCOVERY_SECRET must be 64 hex characters when configured");
env.SCOUT_LOCAL_DISCOVERY_SECRET = secret;

const catalogPath = fileURLToPath(new URL("../config/discovery-sources.json", import.meta.url));
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const internshipPattern = /\b(intern|internship|trainee|apprentice|co-?op)\b/i;
const indiaOrRemotePattern = /\b(india|bengaluru|bangalore|chennai|hyderabad|noida|gurugram|gurgaon|mumbai|delhi|pune|kolkata|remote)\b/i;

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function relevant(job) {
  if (!internshipPattern.test(`${job.title}\n${job.description}`)) return false;
  return indiaOrRemotePattern.test(`${job.location}\n${job.workplaceType}\n${job.description.slice(0, 1600)}`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "ScoutLocalDiscovery/0.1" },
    signal: AbortSignal.timeout(12_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function discoverSource(source) {
  if (source.provider === "greenhouse") {
    const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.slug)}/jobs?content=true`;
    const payload = await fetchJson(endpoint);
    if (!Array.isArray(payload.jobs)) throw new Error("invalid Greenhouse payload");
    return payload.jobs.map((raw) => ({
      provider: "greenhouse",
      slug: source.slug,
      company: source.company,
      companyDomain: source.companyDomain,
      sourceUrl: source.sourceUrl,
      focus: source.focus,
      externalId: String(raw.id),
      canonicalUrl: String(raw.absolute_url),
      title: String(raw.title),
      description: stripHtml(raw.content),
      location: String(raw.location?.name ?? ""),
      workplaceType: "unspecified",
      postedAt: raw.updated_at ? String(raw.updated_at) : null,
    }));
  }

  const endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(source.slug)}?mode=json`;
  const payload = await fetchJson(endpoint);
  if (!Array.isArray(payload)) throw new Error("invalid Lever payload");
  return payload.map((raw) => ({
    provider: "lever",
    slug: source.slug,
    company: source.company,
    companyDomain: source.companyDomain,
    sourceUrl: source.sourceUrl,
    focus: source.focus,
    externalId: String(raw.id),
    canonicalUrl: String(raw.hostedUrl),
    title: String(raw.text),
    description: String(raw.descriptionPlain ?? stripHtml(raw.description)),
    location: String(raw.categories?.location ?? ""),
    workplaceType: ["remote", "hybrid", "on-site"].includes(String(raw.workplaceType ?? "").toLowerCase()) ? String(raw.workplaceType).toLowerCase() : "unspecified",
    postedAt: null,
  }));
}

async function discover() {
  const settled = await Promise.allSettled(catalog.map(async (source) => ({ source, jobs: await discoverSource(source) })));
  const leads = [];
  const failures = [];
  settled.forEach((result, index) => {
    const source = catalog[index];
    if (result.status === "rejected") {
      failures.push({ company: source.company, provider: source.provider, reason: result.reason instanceof Error ? result.reason.message.slice(0, 120) : "fetch failed" });
      return;
    }
    for (const job of result.value.jobs) if (relevant(job)) leads.push(job);
  });
  const deduped = [...new Map(leads.map((lead) => [lead.canonicalUrl, lead])).values()].slice(0, 80);
  const payload = JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(), leads: deduped, failures });
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
