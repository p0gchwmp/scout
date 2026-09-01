import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  assertSafeLocalDemoEnvironment,
  assertScoutSchema,
  resolveLocalD1Database,
} from "./scout-demo-db.mjs";
import { resetAllLocalData } from "./scout-demo-reset-policy.mjs";

function openLocalDatabase(cwd = process.cwd(), env = process.env) {
  assertSafeLocalDemoEnvironment(env);
  const databasePath = resolveLocalD1Database(cwd);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON");
  assertScoutSchema(database);
  return { databasePath, database };
}

export async function runFullLocalReset({ args = process.argv.slice(2), cwd = process.cwd(), env = process.env } = {}) {
  const confirmed = args.includes("--confirm-local-reset");
  const allowAllLocalData = args.includes("--allow-all-local-data");
  const { databasePath, database } = openLocalDatabase(cwd, env);
  try {
    const result = resetAllLocalData(database, { confirmed, allowAllLocalData });
    return { databasePath, result };
  } finally {
    database.close();
  }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  runFullLocalReset().then(({ databasePath, result }) => {
    console.log(`Scout full local reset database: ${databasePath}`);
    console.log("Mode: LOCAL D1 SQLITE ONLY — ALL local Scout rows deleted after dual confirmation");
    console.log("Full local reset complete:", result);
  }).catch((error) => {
    console.error(`Scout full local reset error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
