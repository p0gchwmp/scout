import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HEX_64 = /^[a-f0-9]{64}$/i;
const FORBIDDEN_HOSTED_VARS = [
  "SCOUT_LOCAL_DEV_RUNTIME",
  "SCOUT_LOCAL_DEV_AUTH",
  "SCOUT_LOCAL_DEV_USER_ID",
  "SCOUT_LOCAL_DISCOVERY_SECRET",
  "SCOUT_BROWSER_HANDOFF_SECRET",
  "SCOUT_AGENT_ALLOW_LOOPBACK_DEV",
];

function enabled(value) {
  if (value === undefined || value === null) return false;
  return !["", "0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function publicHttps(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return !(
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || host === "::1"
  );
}

export function inspectHostedEnvironment(env = process.env) {
  const checks = [];
  const owner = present(env.SCOUT_OWNER_USER_ID);
  checks.push({ name: "owner", ok: owner, required: true, detail: owner ? "SCOUT_OWNER_USER_ID is configured." : "SCOUT_OWNER_USER_ID is required; Scout must fail closed without it." });

  for (const key of FORBIDDEN_HOSTED_VARS) {
    const configured = key.includes("SECRET") || key.endsWith("USER_ID") ? present(env[key]) : enabled(env[key]);
    checks.push({ name: `forbid:${key}`, ok: !configured, required: true, detail: configured ? `${key} is local-development-only and must not be enabled in hosted Scout.` : `${key} is not enabled.` });
  }

  const agentUrl = present(env.SCOUT_AGENT_BASE_URL);
  const agentSecret = present(env.SCOUT_AGENT_SHARED_SECRET);
  if (agentUrl !== agentSecret) {
    checks.push({ name: "agent_pair", ok: false, required: false, detail: "Optional cloud agent URL and shared secret must be configured together." });
  } else if (agentUrl && agentSecret) {
    checks.push({ name: "agent_url", ok: publicHttps(env.SCOUT_AGENT_BASE_URL), required: false, detail: publicHttps(env.SCOUT_AGENT_BASE_URL) ? "Optional cloud agent uses a public HTTPS origin." : "Optional cloud agent origin must be public HTTPS and non-loopback." });
    checks.push({ name: "agent_secret", ok: HEX_64.test(String(env.SCOUT_AGENT_SHARED_SECRET).trim()), required: false, detail: HEX_64.test(String(env.SCOUT_AGENT_SHARED_SECRET).trim()) ? "Optional cloud agent shared secret has the required format." : "Optional cloud agent shared secret must be 64 hex characters." });
  } else {
    checks.push({ name: "agent", ok: true, required: false, detail: "Optional cloud agent is disabled." });
  }

  return checks;
}

function hostingBindings(root = process.cwd()) {
  try {
    const raw = JSON.parse(readFileSync(resolve(root, ".openai/hosting.json"), "utf8"));
    return { db: raw?.d1 === "DB", files: raw?.r2 === "FILES" };
  } catch {
    return { db: false, files: false };
  }
}

function selfTest() {
  const safe = inspectHostedEnvironment({ SCOUT_OWNER_USER_ID: "owner-prod" });
  if (safe.some((check) => check.required && !check.ok)) throw new Error("Hosted owner-only self-test failed");
  const missing = inspectHostedEnvironment({});
  if (!missing.some((check) => check.name === "owner" && !check.ok)) throw new Error("Missing-owner fail-closed self-test failed");
  const localLeak = inspectHostedEnvironment({ SCOUT_OWNER_USER_ID: "owner", SCOUT_LOCAL_DEV_AUTH: "1" });
  if (!localLeak.some((check) => check.name === "forbid:SCOUT_LOCAL_DEV_AUTH" && !check.ok)) throw new Error("Local-auth leak self-test failed");
  const loopbackAgent = inspectHostedEnvironment({ SCOUT_OWNER_USER_ID: "owner", SCOUT_AGENT_BASE_URL: "http://127.0.0.1:8788", SCOUT_AGENT_SHARED_SECRET: "a".repeat(64) });
  if (!loopbackAgent.some((check) => check.name === "agent_url" && !check.ok)) throw new Error("Loopback-agent self-test failed");
  console.log("Scout hosted-readiness self-test: OK (configuration checks only; nothing deployed)." );
}

const allowed = new Set(["--json", "--self-test"]);
for (const argument of process.argv.slice(2)) if (!allowed.has(argument)) throw new Error(`Unknown Scout hosting doctor option: ${argument}`);
if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }

const checks = inspectHostedEnvironment();
const bindings = hostingBindings();
checks.push({ name: "binding:DB", ok: bindings.db, required: true, detail: bindings.db ? "Hosting declares the DB binding." : "Expected D1 binding DB is missing from .openai/hosting.json." });
checks.push({ name: "binding:FILES", ok: bindings.files, required: false, detail: bindings.files ? "Hosting declares the FILES binding." : "Optional FILES binding is not declared as expected." });
const blockers = checks.filter((check) => check.required && !check.ok);
const attention = checks.filter((check) => !check.required && !check.ok);
const result = { readyForExplicitDeployApproval: blockers.length === 0, blockers: blockers.length, attention: attention.length, checks };

if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Scout hosting doctor: ${blockers.length ? "BLOCKED" : attention.length ? "ATTENTION" : "READY FOR EXPLICIT DEPLOY APPROVAL"}`);
  for (const check of checks) console.log(`[${check.required ? (check.ok ? "PASS" : "FAIL") : check.ok ? "INFO" : "ATTN"}] ${check.name}: ${check.detail}`);
  console.log("This command does not deploy Scout, migrate a hosted database, send outreach, or submit an application.");
}
process.exitCode = blockers.length ? 1 : 0;
