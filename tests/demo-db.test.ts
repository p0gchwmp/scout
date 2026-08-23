import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  assertSafeLocalDemoEnvironment,
  getLocalDemoStatus,
  resetLocalDemo,
  resolveLocalD1Database,
  seedLocalDemo,
} from "../scripts/scout-demo-db.mjs";

function applyScoutMigrations(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of ["0000_heavy_slapstick.sql", "0001_scout_vertical.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    database.exec(sql);
  }
}

function createLocalDemoDatabase() {
  const root = mkdtempSync(join(tmpdir(), "scout-demo-db-"));
  const d1Directory = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
  mkdirSync(d1Directory, { recursive: true });
  const databasePath = join(d1Directory, "demo.sqlite");
  const database = new DatabaseSync(databasePath);
  applyScoutMigrations(database);
  return { root, d1Directory, databasePath, database };
}

test("local demo tooling fails closed in production-like environments", () => {
  assert.throws(() => assertSafeLocalDemoEnvironment({ NODE_ENV: "production" }), /NODE_ENV=production/);
  assert.throws(() => assertSafeLocalDemoEnvironment({ CI: "true" }), /CI is enabled/);
  assert.throws(() => assertSafeLocalDemoEnvironment({ CF_PAGES: "1" }), /CF_PAGES is enabled/);
  assert.doesNotThrow(() => assertSafeLocalDemoEnvironment({ NODE_ENV: "development" }));
});

test("local demo database resolver only accepts one repo-local Wrangler D1 file", () => {
  const { root, d1Directory, databasePath, database } = createLocalDemoDatabase();
  database.close();
  try {
    assert.equal(resolveLocalD1Database(root), databasePath);
    writeFileSync(join(d1Directory, "second.sqlite"), "");
    assert.throws(() => resolveLocalD1Database(root), /found 2.*ambiguous/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("demo seed is synthetic, local-only, deterministic, and reset restores safety triggers", () => {
  const { root, database } = createLocalDemoDatabase();
  try {
    const first = seedLocalDemo(database);
    const second = seedLocalDemo(database);
    assert.deepEqual(first, { sources: 3, jobs: 3, claims: 8 });
    assert.deepEqual(second, first);

    const status = getLocalDemoStatus(database);
    assert.deepEqual(status.demoCounts, { sources: 3, jobs: 3, claims: 8 });
    assert.deepEqual(status.expected, status.demoCounts);

    const sources = database.prepare("SELECT company_domain, enabled FROM company_sources WHERE id LIKE 'demo_%' ORDER BY id").all();
    assert.equal(sources.length, 3);
    assert.ok(sources.every((source) => String(source.company_domain).endsWith(".example")));
    assert.ok(sources.every((source) => source.enabled === 0));

    const education = database.prepare("SELECT statement, evidence, status FROM candidate_claims WHERE id = 'demo_claim_education'").get();
    assert.equal(education.status, "approved");
    assert.doesNotMatch(String(education.statement), /8\.25|CGPA/i);
    assert.match(String(education.evidence), /LOCAL DEMO ONLY/);

    assert.throws(() => resetLocalDemo(database), /--confirm-local-reset/);
    const reset = resetLocalDemo(database, { confirmed: true });
    assert.ok(Object.values(reset).every((count) => count === 0));

    const triggers = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => row.name));
    for (const trigger of [
      "job_snapshots_immutable_update",
      "job_snapshots_immutable_delete",
      "candidate_claims_approved_immutable_update",
      "candidate_claims_approved_immutable_delete",
      "outreach_revisions_immutable_update",
      "outreach_revisions_immutable_delete",
    ]) assert.ok(triggers.has(trigger), `${trigger} was not restored`);

    assert.deepEqual(seedLocalDemo(database), { sources: 3, jobs: 3, claims: 8 });
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("demo database script has no remote or network execution path", () => {
  const script = readFileSync(new URL("../scripts/scout-demo-db.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /node:child_process/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /cloudflare:workers/);
  assert.doesNotMatch(script, /--remote/);
});
