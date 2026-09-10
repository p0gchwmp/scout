import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const LEGACY_SCHEMA = `
CREATE TABLE candidate_claims (
  id text PRIMARY KEY NOT NULL,
  statement text NOT NULL,
  evidence text NOT NULL,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'approved', 'rejected')),
  version integer DEFAULT 1 NOT NULL,
  approved_at text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TRIGGER candidate_claims_approved_immutable_update
BEFORE UPDATE ON candidate_claims
WHEN OLD.status = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved candidate claims are immutable'); END;
CREATE TRIGGER candidate_claims_approved_immutable_delete
BEFORE DELETE ON candidate_claims
WHEN OLD.status = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved candidate claims are immutable'); END;
`;

function approved(database: DatabaseSync, id: string) {
  database.prepare(`
    INSERT INTO candidate_claims(id, statement, evidence, status, version, approved_at)
    VALUES (?, 'Approved statement', 'Approved evidence', 'approved', 2, '2026-09-09T01:00:00.000Z')
  `).run(id);
}

test("legacy approved-claim trigger blocks the retirement transition", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(LEGACY_SCHEMA);
  approved(database, "legacy");

  assert.throws(
    () => database.prepare(`
      UPDATE candidate_claims
      SET status = 'rejected', version = version + 1, updated_at = '2026-09-10T00:00:00.000Z'
      WHERE id = 'legacy' AND status = 'approved' AND version = 2
    `).run(),
    /approved candidate claims are immutable/,
  );
  const unchanged = database.prepare("SELECT status, version FROM candidate_claims WHERE id = 'legacy'").get() as { status: string; version: number };
  assert.equal(unchanged.status, "approved");
  assert.equal(unchanged.version, 2);
  database.close();
});

test("retirement trigger migration permits only the history-preserving approved-to-retired transition", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(LEGACY_SCHEMA);
  const migration = (await readFile(new URL("../drizzle/0013_claim_retirement_trigger.sql", import.meta.url), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
  database.exec(migration);

  approved(database, "retire-me");
  const before = database.prepare(`
    SELECT statement, evidence, approved_at, created_at FROM candidate_claims WHERE id = 'retire-me'
  `).get() as { statement: string; evidence: string; approved_at: string; created_at: string };
  const result = database.prepare(`
    UPDATE candidate_claims
    SET status = 'rejected', version = version + 1, updated_at = '2026-09-10T00:00:00.000Z'
    WHERE id = 'retire-me' AND status = 'approved' AND version = 2
  `).run();
  assert.equal(result.changes, 1);

  const retired = database.prepare(`
    SELECT statement, evidence, status, version, approved_at, created_at
    FROM candidate_claims WHERE id = 'retire-me'
  `).get() as { statement: string; evidence: string; status: string; version: number; approved_at: string; created_at: string };
  assert.equal(retired.status, "rejected");
  assert.equal(retired.version, 3);
  assert.equal(retired.statement, before.statement);
  assert.equal(retired.evidence, before.evidence);
  assert.equal(retired.approved_at, before.approved_at);
  assert.equal(retired.created_at, before.created_at);

  approved(database, "immutable-still");
  assert.throws(
    () => database.prepare("UPDATE candidate_claims SET statement = 'tampered' WHERE id = 'immutable-still'").run(),
    /approved candidate claims are immutable/,
  );
  assert.throws(
    () => database.prepare(`
      UPDATE candidate_claims
      SET status = 'rejected', evidence = 'tampered', version = version + 1
      WHERE id = 'immutable-still'
    `).run(),
    /approved candidate claims are immutable/,
  );
  assert.throws(
    () => database.prepare("DELETE FROM candidate_claims WHERE id = 'immutable-still'").run(),
    /approved candidate claims are immutable/,
  );
  database.close();
});
