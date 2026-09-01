import { createServer } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const d1Dir = resolve(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const MIN_NODE = [22, 13, 0];
const AUTH_KEYS = ["SCOUT_LOCAL_DEV_AUTH", "SCOUT_LOCAL_DEV_USER_ID", "SCOUT_OWNER_USER_ID"];
const REQUIRED_PORTS = [3000, 43119];

function enabled(value) {
  if (value === undefined || value === null) return false;
  return !["", "0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function compareVersion(version, minimum = MIN_NODE) {
  const parts = String(version).split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < minimum.length; index += 1) {
    const current = parts[index] ?? 0;
    if (current > minimum[index]) return 1;
    if (current < minimum[index]) return -1;
  }
  return 0;
}

function classifyAuthEnv(env = process.env) {
  const configured = AUTH_KEYS.filter((key) => typeof env[key] === "string" && env[key].trim());
  if (configured.length === 0) {
    return { ok: true, detail: "No explicit dev auth configured; npm run dev will create its loopback-only owner identity." };
  }
  if (configured.length !== AUTH_KEYS.length) {
    return { ok: false, detail: `Partial local auth configuration (${configured.length}/${AUTH_KEYS.length}); Scout intentionally fails closed.` };
  }
  if (!enabled(env.SCOUT_LOCAL_DEV_AUTH)) {
    return { ok: false, detail: "SCOUT_LOCAL_DEV_AUTH is configured but disabled; local owner auth would fail closed." };
  }
  if (env.SCOUT_LOCAL_DEV_USER_ID.trim() !== env.SCOUT_OWNER_USER_ID.trim()) {
    return { ok: false, detail: "SCOUT_LOCAL_DEV_USER_ID and SCOUT_OWNER_USER_ID do not match." };
  }
  return { ok: true, detail: "Explicit local owner auth is complete and internally consistent." };
}

function localDatabaseFiles() {
  if (!existsSync(d1Dir)) return [];
  return readdirSync(d1Dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite")
    .map((entry) => resolve(d1Dir, entry.name));
}

function hasWranglerMigrationLedger(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").get());
  } finally {
    database.close();
  }
}

function inspectDatabaseState() {
  const files = localDatabaseFiles();
  if (files.length === 0) {
    return { ok: true, detail: "No local D1 exists yet; npm run dev can initialize a fresh migration-tracked database." };
  }
  if (files.length > 1) {
    return { ok: false, detail: `Found ${files.length} local D1 databases; M32 will refuse an ambiguous migration target.` };
  }
  try {
    if (!hasWranglerMigrationLedger(files[0])) {
      return {
        ok: false,
        detail: "Legacy/manual local D1 detected without Wrangler migration ledger; M32 will preserve it rather than replay migrations. Move the old .wrangler state aside before requesting a fresh local database.",
      };
    }
  } catch (error) {
    return { ok: false, detail: `Unable to inspect the local D1 safely: ${error instanceof Error ? error.message : "unknown error"}` };
  }
  return { ok: true, detail: "One Wrangler-managed local D1 exists and is eligible for pending-migration checks." };
}

async function portAvailable(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePromise(true)));
  });
}

function selfTest() {
  if (compareVersion("22.13.0") < 0 || compareVersion("22.12.9") >= 0 || compareVersion("23.0.0") < 0) {
    throw new Error("Scout doctor Node version self-test failed");
  }
  if (!classifyAuthEnv({}).ok) throw new Error("Scout doctor auto-auth self-test failed");
  if (classifyAuthEnv({ SCOUT_LOCAL_DEV_AUTH: "1" }).ok) throw new Error("Scout doctor partial-auth self-test failed");
  if (!classifyAuthEnv({
    SCOUT_LOCAL_DEV_AUTH: "1",
    SCOUT_LOCAL_DEV_USER_ID: "owner",
    SCOUT_OWNER_USER_ID: "owner",
  }).ok) throw new Error("Scout doctor explicit-auth self-test failed");
  console.log("Scout doctor self-test: OK (read-only local readiness checks)." );
}

const allowed = new Set(["--json", "--self-test"]);
for (const argument of process.argv.slice(2)) {
  if (!allowed.has(argument)) throw new Error(`Unknown Scout doctor option: ${argument}`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const checks = [];
function add(name, ok, detail, required = true) {
  checks.push({ name, ok: Boolean(ok), required, detail });
}

add("Node.js", compareVersion(process.versions.node) >= 0, `Running Node ${process.versions.node}; Scout requires >= ${MIN_NODE.join(".")}.`);
add("Dependencies", existsSync(resolve(root, "node_modules/vinext")) && existsSync(resolve(root, "node_modules/wrangler")), "Run npm ci if Vinext/Wrangler dependencies are missing.");
const migrationCount = existsSync(resolve(root, "drizzle"))
  ? readdirSync(resolve(root, "drizzle"), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".sql")).length
  : 0;
add("Migrations", migrationCount > 0, `${migrationCount} SQL migration file(s) found in drizzle/.`);
add("Local-only environment", String(process.env.NODE_ENV ?? "").trim().toLowerCase() !== "production" && !enabled(process.env.CF_PAGES) && !enabled(process.env.WORKERS_CI), "NODE_ENV=production, CF_PAGES, and WORKERS_CI must stay disabled for local bootstrap.");
const auth = classifyAuthEnv();
add("Owner auth", auth.ok, auth.detail);
const database = inspectDatabaseState();
add("Local D1", database.ok, database.detail);
for (const port of REQUIRED_PORTS) {
  add(`Loopback port ${port}`, await portAvailable(port), `127.0.0.1:${port} must be free before starting Scout.`);
}

const freeAiKeys = ["SCOUT_NIM_FREE_API_KEY", "SCOUT_GROQ_FREE_API_KEY", "SCOUT_GEMINI_FREE_API_KEY", "SCOUT_CEREBRAS_FREE_API_KEY", "SCOUT_OPENROUTER_FREE_API_KEY"];
const freeAiCount = freeAiKeys.filter((key) => typeof process.env[key] === "string" && process.env[key].trim()).length;
add("Optional AI", true, freeAiCount > 0 ? `${freeAiCount} free/included AI provider key(s) configured.` : "No free cloud AI key detected; deterministic Scout features still run and local Ollama may be auto-detected.", false);

const blockers = checks.filter((check) => check.required && !check.ok);
const result = { ready: blockers.length === 0, blockers: blockers.length, checks };
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Scout doctor: ${result.ready ? "READY" : "BLOCKED"} (${blockers.length} blocking issue${blockers.length === 1 ? "" : "s"})`);
  for (const check of checks) {
    const marker = check.required ? (check.ok ? "PASS" : "FAIL") : "INFO";
    console.log(`[${marker}] ${check.name}: ${check.detail}`);
  }
  if (result.ready) console.log("Next: npm run dev (or npm run dev:demo for the synthetic local workflow)." );
}

process.exitCode = result.ready ? 0 : 1;
