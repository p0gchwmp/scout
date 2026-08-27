import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const d1Dir = resolve(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
if (!existsSync(d1Dir)) throw new Error(`Local Scout D1 directory not found: ${d1Dir}`);
const candidates = readdirSync(d1Dir)
  .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
  .map((name) => resolve(d1Dir, name));
if (candidates.length !== 1) throw new Error(`Expected exactly one local Scout D1 database; found ${candidates.length}`);

const dbPath = candidates[0];
const db = new DatabaseSync(dbPath);
const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_outreach_targets'").get();
if (table) {
  console.log("Company-first outreach schema already present.");
  db.close();
  process.exit(0);
}

const integrity = db.prepare("PRAGMA integrity_check").get();
if (!integrity || Object.values(integrity)[0] !== "ok") throw new Error("Local Scout D1 integrity check failed before migration");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `${dbPath}.backup-company-outreach-${stamp}`;
db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
const sql = readFileSync(resolve(root, "drizzle/0011_company_outreach_targets.sql"), "utf8").replaceAll("--> statement-breakpoint", "");
try {
  db.exec(`PRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n${sql}\nCOMMIT;`);
} catch (error) {
  try { db.exec("ROLLBACK;"); } catch {}
  throw error;
}
const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
if (foreignKeys.length) throw new Error("Foreign-key check failed after company-outreach migration");
const integrityAfter = db.prepare("PRAGMA integrity_check").get();
if (!integrityAfter || Object.values(integrityAfter)[0] !== "ok") throw new Error("Local Scout D1 integrity check failed after migration");
console.log("SCOUT COMPANY-OUTREACH LOCAL MIGRATION: GREEN");
console.log("Backup:", backup);
db.close();
