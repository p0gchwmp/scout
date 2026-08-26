import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeLocalDemoEnvironment,
  assertScoutSchema,
  resolveLocalD1Database,
} from "./scout-demo-db.mjs";

export const CORRECT_PROGRAM = "Bachelor of Science (B.S.) in Management and Public Policy";
export const CONDITIONAL_GRADUATION_PATH = "2028 (B.S. exit) / 2029 (B.S. Honours with Research)";

const LEGACY_PROGRAM = "Management and Public Policy undergraduate program";
const LEGACY_GRADUATION = "2029";
const PROGRAM_EVIDENCE = "Ryan-confirmed official degree wording for Scout application use. Re-verify this corrected exact value before Safe Fill reuse.";
const GRADUATION_EVIDENCE = "Ryan-confirmed degree path: B.S. exit award in 2028; B.S. (Honours with Research) in 2029. Graduation year remains manual per application.";

export function repairEducationProfile(database, now = new Date().toISOString()) {
  const program = database.prepare("SELECT * FROM profile_evidence WHERE kind = 'program' LIMIT 1").get();
  if (program && ![LEGACY_PROGRAM, CORRECT_PROGRAM].includes(String(program.claim))) {
    throw new Error(`Refusing to overwrite a different program value: ${program.claim}`);
  }

  let programAction;
  if (program) {
    if (program.claim === CORRECT_PROGRAM) {
      database.prepare("UPDATE profile_evidence SET evidence = ?, updated_at = ? WHERE id = ?")
        .run(PROGRAM_EVIDENCE, now, program.id);
      programAction = "kept";
    } else {
      database.prepare("UPDATE profile_evidence SET claim = ?, evidence = ?, verified = 0, updated_at = ? WHERE id = ?")
        .run(CORRECT_PROGRAM, PROGRAM_EVIDENCE, now, program.id);
      programAction = "corrected_unverified";
    }
  } else {
    database.prepare("INSERT INTO profile_evidence (id, kind, claim, evidence, verified, updated_at) VALUES (?, 'program', ?, ?, 0, ?)")
      .run(randomUUID(), CORRECT_PROGRAM, PROGRAM_EVIDENCE, now);
    programAction = "created_unverified";
  }

  const graduation = database.prepare("SELECT * FROM profile_evidence WHERE kind = 'graduation_year' LIMIT 1").get();
  if (graduation && ![LEGACY_GRADUATION, CONDITIONAL_GRADUATION_PATH].includes(String(graduation.claim))) {
    throw new Error(`Refusing to overwrite a different graduation-year value: ${graduation.claim}`);
  }

  let graduationAction;
  if (graduation) {
    database.prepare("UPDATE profile_evidence SET claim = ?, evidence = ?, verified = 0, updated_at = ? WHERE id = ?")
      .run(CONDITIONAL_GRADUATION_PATH, GRADUATION_EVIDENCE, now, graduation.id);
    graduationAction = graduation.claim === CONDITIONAL_GRADUATION_PATH ? "kept_manual" : "corrected_manual";
  } else {
    database.prepare("INSERT INTO profile_evidence (id, kind, claim, evidence, verified, updated_at) VALUES (?, 'graduation_year', ?, ?, 0, ?)")
      .run(randomUUID(), CONDITIONAL_GRADUATION_PATH, GRADUATION_EVIDENCE, now);
    graduationAction = "created_manual";
  }

  return { program: programAction, graduationYear: graduationAction };
}

function openLocalDatabase(cwd = process.cwd(), env = process.env) {
  assertSafeLocalDemoEnvironment(env);
  const databasePath = resolveLocalD1Database(cwd);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON");
  assertScoutSchema(database);
  return { databasePath, database };
}

async function main() {
  const { databasePath, database } = openLocalDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    const result = repairEducationProfile(database);
    database.exec("COMMIT");
    console.log(`Scout local profile database: ${databasePath}`);
    console.log("Education profile repaired locally only; no remote service was contacted.");
    console.log(result);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The original failure is more useful than a secondary rollback failure.
    }
    throw error;
  } finally {
    database.close();
  }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(`Scout profile repair error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
