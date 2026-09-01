import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  assertSafeLocalDemoEnvironment,
  assertScoutSchema,
  resolveLocalD1Database,
} from "./scout-demo-db.mjs";
import { resetDemoRowsOnly } from "./scout-demo-reset-policy.mjs";

function openLocalDatabase(cwd = process.cwd(), env = process.env) {
  assertSafeLocalDemoEnvironment(env);
  const databasePath = resolveLocalD1Database(cwd);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON");
  assertScoutSchema(database);
  return { databasePath, database };
}

export async function runSafeDemoReset({ args = process.argv.slice(2), cwd = process.cwd(), env = process.env } = {}) {
  const confirmed = args.includes("--confirm-demo-reset");
  const { databasePath, database } = openLocalDatabase(cwd, env);
  try {
    const result = resetDemoRowsOnly(database, { confirmed });
    return { databasePath, result };
  } finally {
    database.close();
  }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  runSafeDemoReset().then(({ databasePath, result }) => {
    console.log(`Scout demo reset database: ${databasePath}`);
    console.log("Mode: LOCAL D1 SQLITE ONLY — deleting reserved demo_* rows only; non-demo local rows are preserved");
    console.log("Demo reset complete:", result);
  }).catch((error) => {
    console.error(`Scout safe demo reset error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
