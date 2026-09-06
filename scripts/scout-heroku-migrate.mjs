import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RemoteD1Database, remoteD1ConfigFromEnv } from "../db/remote-d1.ts";

const root = process.cwd();
const migrationsDir = resolve(root, "drizzle");
const MIGRATION_FILE = /^\d+[^/\\]*\.sql$/;
const BREAKPOINT = /^\s*-->\s*statement-breakpoint\s*$/gm;

export function normalizeD1MigrationStatement(statement) {
  const normalized = statement.replace(/\r\n?/g, "\n");
  if (!/^\s*CREATE\s+TRIGGER\b/i.test(normalized)) return normalized;
  return normalized.replace(
    /\bSELECT\s+CASE\b([\s\S]*?)\bEND\s*;/gi,
    (_match, body) => `SELECT (CASE${body}END);`,
  );
}

export function splitMigrationSql(sql) {
  return sql
    .split(BREAKPOINT)
    .map((statement) => normalizeD1MigrationStatement(statement.trim()))
    .filter(Boolean);
}

async function migrationNames() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function migrate() {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Scout Heroku migration release requires NODE_ENV=production");
  }

  const db = new RemoteD1Database(remoteD1ConfigFromEnv());
  await db.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();

  const appliedResult = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
  const applied = new Set((appliedResult.results ?? []).map((row) => String(row.name ?? "")).filter(Boolean));
  const names = await migrationNames();
  const known = new Set(names);

  for (const name of applied) {
    if (!known.has(name)) {
      throw new Error(`Scout D1 contains migration not present in this release: ${name}`);
    }
  }

  let count = 0;
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = await readFile(resolve(migrationsDir, name), "utf8");
    const statements = splitMigrationSql(sql);
    if (!statements.length) throw new Error(`Scout migration is empty: ${name}`);

    const prepared = statements.map((statement) => db.prepare(statement));
    prepared.push(db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(name));
    const results = await db.batch(prepared);
    if (results.some((result) => result.success !== true)) {
      throw new Error(`Scout D1 migration failed: ${name}`);
    }
    count += 1;
    console.log(`Scout D1 migration applied: ${name}`);
  }

  console.log(count ? `Scout D1 migrations applied: ${count}.` : "Scout D1 migrations: already current.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await migrate();
}
