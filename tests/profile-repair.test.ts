import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CONDITIONAL_GRADUATION_PATH, CORRECT_PROGRAM, repairEducationProfile } from "../scripts/scout-profile-repair.mjs";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE profile_evidence (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    claim TEXT NOT NULL,
    evidence TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`);
  return db;
}

test("profile repair corrects the exact legacy program and makes corrected education values conservative", () => {
  const db = database();
  db.prepare("INSERT INTO profile_evidence VALUES (?, ?, ?, ?, ?, ?)").run("p1", "program", "Management and Public Policy undergraduate program", "old", 1, "old");
  db.prepare("INSERT INTO profile_evidence VALUES (?, ?, ?, ?, ?, ?)").run("p2", "graduation_year", "2029", "old", 1, "old");
  const result = repairEducationProfile(db, "2026-08-26T00:00:00.000Z");
  assert.deepEqual(result, { program: "corrected_unverified", graduationYear: "corrected_manual" });
  const program = db.prepare("SELECT * FROM profile_evidence WHERE kind='program'").get();
  const graduation = db.prepare("SELECT * FROM profile_evidence WHERE kind='graduation_year'").get();
  assert.equal(program.claim, CORRECT_PROGRAM);
  assert.equal(program.verified, 0);
  assert.equal(graduation.claim, CONDITIONAL_GRADUATION_PATH);
  assert.equal(graduation.verified, 0);
  db.close();
});

test("profile repair preserves verification only when the exact corrected program was already stored", () => {
  const db = database();
  db.prepare("INSERT INTO profile_evidence VALUES (?, ?, ?, ?, ?, ?)").run("p1", "program", CORRECT_PROGRAM, "owner", 1, "old");
  const result = repairEducationProfile(db, "2026-08-26T00:00:00.000Z");
  assert.equal(result.program, "kept");
  assert.equal(db.prepare("SELECT verified FROM profile_evidence WHERE kind='program'").get().verified, 1);
  db.close();
});

test("profile repair refuses to overwrite a different owner value", () => {
  const db = database();
  db.prepare("INSERT INTO profile_evidence VALUES (?, ?, ?, ?, ?, ?)").run("p1", "program", "Different degree", "owner", 1, "old");
  assert.throws(() => repairEducationProfile(db), /Refusing to overwrite/);
  db.close();
});
