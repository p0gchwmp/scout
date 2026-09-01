const DEMO_ID_GLOB = "demo_*";

const RESET_TABLES = [
  "outreach_draft_revisions",
  "outreach_drafts",
  "contact_evidence",
  "applications",
  "job_snapshots",
  "jobs",
  "sync_runs",
  "candidate_claims",
  "company_sources",
  "profile_evidence",
];

// Only these three immutable-delete triggers need to be suspended while
// deleting demo fixtures. Update/insert provenance guards stay live.
const DELETE_BLOCKING_TRIGGERS = [
  "job_snapshots_immutable_delete",
  "candidate_claims_approved_immutable_delete",
  "outreach_revisions_immutable_delete",
];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function countRows(database, table, predicate = "") {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} ${predicate}`).get().count;
}

function captureDeleteTriggers(database) {
  const rows = database.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger' AND sql IS NOT NULL
    ORDER BY name
  `).all().filter((row) => DELETE_BLOCKING_TRIGGERS.includes(row.name));

  const found = new Set(rows.map((row) => row.name));
  const missing = DELETE_BLOCKING_TRIGGERS.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`Refusing demo reset because required immutable-delete triggers are missing: ${missing.join(", ")}`);
  }
  return rows;
}

function assertDeleteTriggersRestored(database) {
  const names = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => row.name));
  const missing = DELETE_BLOCKING_TRIGGERS.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Demo reset failed to restore immutable-delete triggers: ${missing.join(", ")}`);
}

function runReset(database, { demoOnly }) {
  const triggerRows = captureDeleteTriggers(database);
  const nonDemoBefore = demoOnly
    ? Object.fromEntries(RESET_TABLES.map((table) => [table, countRows(database, table, `WHERE id NOT GLOB '${DEMO_ID_GLOB}'`)]))
    : null;

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const trigger of triggerRows) database.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
    for (const table of RESET_TABLES) {
      database.exec(demoOnly
        ? `DELETE FROM ${quoteIdentifier(table)} WHERE id GLOB '${DEMO_ID_GLOB}'`
        : `DELETE FROM ${quoteIdentifier(table)}`);
    }
    for (const trigger of triggerRows) database.exec(trigger.sql);

    const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) throw new Error("Foreign-key check failed during local Scout reset");

    if (nonDemoBefore) {
      for (const table of RESET_TABLES) {
        const after = countRows(database, table, `WHERE id NOT GLOB '${DEMO_ID_GLOB}'`);
        if (after !== nonDemoBefore[table]) {
          throw new Error(`Refusing demo reset because non-demo row count changed in ${table}`);
        }
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  assertDeleteTriggersRestored(database);
  return Object.fromEntries(RESET_TABLES.map((table) => [table, {
    total: countRows(database, table),
    demo: countRows(database, table, `WHERE id GLOB '${DEMO_ID_GLOB}'`),
  }]));
}

export function resetDemoRowsOnly(database, { confirmed = false } = {}) {
  if (!confirmed) {
    throw new Error("Demo reset requires --confirm-demo-reset; it removes only reserved demo_* fixtures from the local Scout D1 database");
  }
  return runReset(database, { demoOnly: true });
}

export function resetAllLocalData(database, { confirmed = false, allowAllLocalData = false } = {}) {
  if (!confirmed) {
    throw new Error("Full local reset requires --confirm-local-reset");
  }
  if (!allowAllLocalData) {
    throw new Error("Full local reset also requires --allow-all-local-data because it deletes non-demo local Scout rows");
  }
  return runReset(database, { demoOnly: false });
}

export const demoResetPolicy = Object.freeze({
  idGlob: DEMO_ID_GLOB,
  resetTables: [...RESET_TABLES],
  suspendedTriggers: [...DELETE_BLOCKING_TRIGGERS],
});
