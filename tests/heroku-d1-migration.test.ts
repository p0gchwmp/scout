import assert from "node:assert/strict";
import test from "node:test";
import { normalizeD1MigrationStatement, splitMigrationSql } from "../scripts/scout-heroku-migrate.mjs";

test("Heroku D1 migration normalization parenthesizes CASE expressions inside triggers", () => {
  const input = `CREATE TRIGGER \`approval_guard\`\r\nBEFORE UPDATE ON \`outreach_drafts\`\r\nBEGIN\r\n  SELECT CASE WHEN OLD.\`state\` <> 'draft' THEN RAISE(ABORT, 'only drafts can be approved') END;\r\nEND;`;
  const normalized = normalizeD1MigrationStatement(input);

  assert.doesNotMatch(normalized, /\r/);
  assert.doesNotMatch(normalized, /\bSELECT\s+CASE\b/i);
  assert.match(
    normalized,
    /SELECT \(CASE WHEN OLD\.\`state\` <> 'draft' THEN RAISE\(ABORT, 'only drafts can be approved'\) END\);/,
  );
});

test("Heroku D1 migration normalization leaves non-trigger CASE queries unchanged", () => {
  const input = "SELECT CASE WHEN 1 = 1 THEN 'yes' ELSE 'no' END;";
  assert.equal(normalizeD1MigrationStatement(input), input);
});

test("migration splitting applies D1 trigger normalization to every statement", () => {
  const sql = `CREATE TABLE probe (id text primary key);\n--> statement-breakpoint\nCREATE TRIGGER probe_guard BEFORE DELETE ON probe\nBEGIN\n  SELECT CASE WHEN OLD.id IS NOT NULL THEN RAISE(ABORT, 'no') END;\nEND;`;
  const statements = splitMigrationSql(sql);

  assert.equal(statements.length, 2);
  assert.match(statements[1], /SELECT \(CASE WHEN OLD\.id IS NOT NULL THEN RAISE\(ABORT, 'no'\) END\);/);
});
