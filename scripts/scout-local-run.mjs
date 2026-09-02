import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const wranglerDir = resolve(root, ".wrangler");
const stateDir = resolve(wranglerDir, "state");
const d1Dir = resolve(stateDir, "v3/d1/miniflare-D1DatabaseObject");
const configPath = resolve(wranglerDir, "scout-local-bootstrap.jsonc");
const wranglerCliPath = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const databaseName = "site-creator-d1";
const databaseId = "00000000-0000-4000-8000-000000000000";

function enabled(value) {
  if (value === undefined || value === null) return false;
  return !["", "0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function assertLocalOnly(env = process.env) {
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error("Refusing Scout local bootstrap with NODE_ENV=production");
  }
  for (const key of ["CF_PAGES", "WORKERS_CI"]) {
    if (enabled(env[key])) throw new Error(`Refusing Scout local bootstrap when ${key} is enabled`);
  }
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

export function buildLocalWranglerConfig() {
  return {
    $schema: "../node_modules/wrangler/config-schema.json",
    name: "scout-local-bootstrap",
    main: "../worker/index.ts",
    compatibility_date: "2026-09-01",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [{
      binding: "DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "../drizzle",
    }],
  };
}

export function buildMigrationArgs() {
  return [
    "d1", "migrations", "apply", databaseName,
    "--local",
    "--persist-to", stateDir,
    "--config", configPath,
  ];
}

async function applyPendingLocalMigrations() {
  assertLocalOnly();
  const before = localDatabaseFiles();
  if (before.length > 1) {
    throw new Error(`Expected at most one local Scout D1 database; found ${before.length}. Refusing an ambiguous target.`);
  }

  if (before.length === 1 && !hasWranglerMigrationLedger(before[0])) {
    console.log("Scout local D1: legacy/manual database detected; leaving it untouched rather than replaying migrations.");
    return;
  }

  mkdirSync(wranglerDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(buildLocalWranglerConfig(), null, 2)}\n`, "utf8");

  if (!existsSync(wranglerCliPath)) {
    throw new Error("Scout local D1 migration bootstrap requires Wrangler; run npm ci first");
  }
  const result = spawnSync(process.execPath, [wranglerCliPath, ...buildMigrationArgs()], {
    cwd: root,
    env: {
      ...process.env,
      CI: "true",
      NO_D1_WARNING: "true",
      WRANGLER_SEND_METRICS: "false",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Scout local D1 migration bootstrap failed with exit code ${result.status ?? "unknown"}`);

  const after = localDatabaseFiles();
  if (after.length !== 1 || !hasWranglerMigrationLedger(after[0])) {
    throw new Error("Scout local D1 migration bootstrap did not produce one migration-tracked local database");
  }
  console.log(before.length === 0
    ? "Scout local D1: fresh database initialized and migrations applied."
    : "Scout local D1: pending migrations checked/applied.");
}

function selfTest() {
  const config = buildLocalWranglerConfig();
  const args = buildMigrationArgs();
  if (config.d1_databases?.[0]?.binding !== "DB") throw new Error("Local D1 binding self-test failed");
  if (config.d1_databases?.[0]?.migrations_dir !== "../drizzle") throw new Error("Local migration directory self-test failed");
  if (!args.includes("--local") || args.includes("--remote")) throw new Error("Local-only migration arguments self-test failed");
  if (!args.includes("--persist-to")) throw new Error("Local persistence self-test failed");
  if (!wranglerCliPath.endsWith(resolve("node_modules", "wrangler", "bin", "wrangler.js"))) throw new Error("Wrangler CLI path self-test failed");
  console.log("Scout local bootstrap self-test: OK (local-only D1 migration plan)." );
}

const allowed = new Set(["--demo", "--self-test"]);
for (const argument of process.argv.slice(2)) {
  if (!allowed.has(argument)) throw new Error(`Unknown Scout local run option: ${argument}`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

await applyPendingLocalMigrations();

if (process.argv.includes("--demo")) {
  const demoScript = fileURLToPath(new URL("./scout-demo-workflow.mjs", import.meta.url));
  const demo = spawnSync(process.execPath, ["--experimental-strip-types", demoScript, "seed"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (demo.error) throw demo.error;
  if (demo.status !== 0) throw new Error(`Scout demo seed failed with exit code ${demo.status ?? "unknown"}`);
}

const devScript = fileURLToPath(new URL("./scout-dev.mjs", import.meta.url));
const child = spawn(process.execPath, [devScript], { cwd: root, env: process.env, stdio: "inherit" });
child.on("error", (error) => {
  console.error("Unable to start Scout local development runtime:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  console.error(`Scout local development runtime exited (${reason}).`);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
