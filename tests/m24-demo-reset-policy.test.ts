import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  demoResetPolicy,
  resetAllLocalData,
  resetDemoRowsOnly,
} from "../scripts/scout-demo-reset-policy.mjs";

function databaseWithScoutSchema() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of ["0000_heavy_slapstick.sql", "0001_scout_vertical.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    database.exec(sql);
  }
  return database;
}

function insertSentinels(database: DatabaseSync) {
  database.prepare(`INSERT INTO candidate_claims (id, statement, evidence, status, version, approved_at) VALUES (?, ?, ?, 'approved', 1, CURRENT_TIMESTAMP)`)
    .run("demo_claim_test", "Synthetic demo", "LOCAL DEMO ONLY");
  database.prepare(`INSERT INTO candidate_claims (id, statement, evidence, status, version, approved_at) VALUES (?, ?, ?, 'approved', 1, CURRENT_TIMESTAMP)`)
    .run("claim_real", "Real local claim", "Local evidence");
  database.prepare(`INSERT INTO candidate_claims (id, statement, evidence, status, version, approved_at) VALUES (?, ?, ?, 'approved', 1, CURRENT_TIMESTAMP)`)
    .run("demoX_real_claim", "Underscore wildcard sentinel", "Must survive demo reset");
  database.prepare(`INSERT INTO profile_evidence (id, kind, claim, evidence, verified) VALUES (?, 'full_name', ?, ?, 1)`)
    .run("demo_profile_test", "Demo Person", "LOCAL DEMO ONLY");
  database.prepare(`INSERT INTO profile_evidence (id, kind, claim, evidence, verified) VALUES (?, 'full_name', ?, ?, 1)`)
    .run("profile_real", "Real Person", "Local evidence");
  database.exec(`CREATE TRIGGER custom_profile_insert_marker AFTER INSERT ON profile_evidence BEGIN SELECT 1; END;`);
}

test("normal M24 reset requires explicit demo-only confirmation", () => {
  const database = databaseWithScoutSchema();
  try {
    assert.throws(() => resetDemoRowsOnly(database), /--confirm-demo-reset/);
  } finally { database.close(); }
});

test("demo reset removes only literal demo_* rows and preserves local owner data", () => {
  const database = databaseWithScoutSchema();
  try {
    insertSentinels(database);
    const result = resetDemoRowsOnly(database, { confirmed: true });
    assert.equal(result.candidate_claims.demo, 0);
    assert.equal(result.profile_evidence.demo, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM candidate_claims WHERE id = 'claim_real'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM candidate_claims WHERE id = 'demoX_real_claim'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM profile_evidence WHERE id = 'profile_real'").get().count, 1);
  } finally { database.close(); }
});

test("demo reset suspends only delete blockers and preserves unrelated triggers", () => {
  const database = databaseWithScoutSchema();
  try {
    insertSentinels(database);
    const before = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => String(row.name)));
    resetDemoRowsOnly(database, { confirmed: true });
    const after = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => String(row.name)));
    assert.ok(after.has("custom_profile_insert_marker"));
    for (const name of demoResetPolicy.suspendedTriggers) assert.ok(after.has(name), `${name} was not restored`);
    assert.deepEqual(after, before);
  } finally { database.close(); }
});

test("full local wipe remains available but requires two explicit confirmations", () => {
  const database = databaseWithScoutSchema();
  try {
    insertSentinels(database);
    assert.throws(() => resetAllLocalData(database), /--confirm-local-reset/);
    assert.throws(() => resetAllLocalData(database, { confirmed: true }), /--allow-all-local-data/);
    const result = resetAllLocalData(database, { confirmed: true, allowAllLocalData: true });
    assert.ok(Object.values(result).every((entry) => entry.total === 0));
  } finally { database.close(); }
});

test("M24 reset policy has no network or remote execution path", () => {
  const source = readFileSync(new URL("../scripts/scout-demo-reset-policy.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:child_process/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /--remote/);
  assert.match(source, /DEMO_ID_GLOB = "demo_\*"/);
});
