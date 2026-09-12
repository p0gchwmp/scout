import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const LOCAL_D1_RELATIVE_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const REQUIRED_TABLES = [
  "company_sources",
  "sync_runs",
  "jobs",
  "job_snapshots",
  "contact_evidence",
  "candidate_claims",
  "outreach_drafts",
  "outreach_draft_revisions",
  "applications",
  "profile_evidence",
];
const REQUIRED_TRIGGERS = [
  "job_snapshots_immutable_update",
  "job_snapshots_immutable_delete",
  "candidate_claims_approved_immutable_update",
  "candidate_claims_approved_immutable_delete",
  "outreach_revisions_immutable_update",
  "outreach_revisions_immutable_delete",
];
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
const FIXTURE_TIME = "2026-08-23T00:00:00.000Z";

function enabled(value) {
  if (value === undefined || value === null) return false;
  return !["", "0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

export function assertSafeLocalDemoEnvironment(env = process.env) {
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error("Refusing Scout demo database tooling with NODE_ENV=production");
  }

  for (const key of ["CF_PAGES", "WORKERS_CI", "CI"]) {
    if (enabled(env[key])) {
      throw new Error(`Refusing Scout demo database tooling when ${key} is enabled`);
    }
  }
}

function isWithinDirectory(file, directory) {
  return file === directory || file.startsWith(`${directory}${sep}`);
}

export function resolveLocalD1Database(cwd = process.cwd()) {
  const localDir = resolve(cwd, LOCAL_D1_RELATIVE_DIR);
  if (!existsSync(localDir)) {
    throw new Error(
      `Local D1 state was not found at ${LOCAL_D1_RELATIVE_DIR}. Start the local app and apply migrations before using demo tooling.`,
    );
  }

  const candidates = readdirSync(localDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
    .map((name) => resolve(localDir, name));

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one local Scout D1 SQLite file in ${LOCAL_D1_RELATIVE_DIR}; found ${candidates.length}. Refusing an ambiguous database target.`,
    );
  }

  const realLocalDir = realpathSync(localDir);
  const realDatabase = realpathSync(candidates[0]);
  if (!isWithinDirectory(realDatabase, realLocalDir)) {
    throw new Error("Refusing a local D1 database path that resolves outside Scout's .wrangler state directory");
  }

  return realDatabase;
}

function listNames(database, type) {
  return new Set(
    database.prepare("SELECT name FROM sqlite_master WHERE type = ?").all(type).map((row) => row.name),
  );
}

export function assertScoutSchema(database) {
  const tables = listNames(database, "table");
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  if (missingTables.length) {
    throw new Error(`Scout migrations are incomplete; missing tables: ${missingTables.join(", ")}`);
  }

  const triggers = listNames(database, "trigger");
  const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !triggers.has(name));
  if (missingTriggers.length) {
    throw new Error(`Scout migrations are incomplete; missing safety triggers: ${missingTriggers.join(", ")}`);
  }
}

function demoHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildDemoFixture() {
  const roles = [
    {
      slug: "health",
      sourceId: "demo_src_health",
      boardToken: "scout-demo-health",
      companyDomain: "demo-health.example",
      company: "Demo HealthTech",
      externalId: "9000001",
      title: "Product Operations Intern",
      location: "India — remote demo",
      workplaceType: "remote",
      description: "Demo fixture only. Part-time role with flexible hours and remote collaboration. Support product and clinic operations workflows, map edge cases, document requirements, analyse spreadsheet data, coordinate stakeholder feedback, and help QA internal tools. This is not a live vacancy.",
    },
    {
      slug: "policy",
      sourceId: "demo_src_policy",
      boardToken: "scout-demo-policy",
      companyDomain: "demo-policy.example",
      company: "Demo Policy Lab",
      externalId: "9000002",
      title: "Policy Research Intern",
      location: "India — remote demo",
      workplaceType: "remote",
      description: "Demo fixture only. Conduct desk research, synthesise evidence, support public-policy analysis, maintain technical documentation, and prepare structured findings in Excel. This is not a live vacancy.",
    },
    {
      slug: "fintech",
      sourceId: "demo_src_fintech",
      boardToken: "scout-demo-fintech",
      companyDomain: "demo-fintech.example",
      company: "Demo Fintech",
      externalId: "9000003",
      title: "Software Engineering Intern",
      location: "Bengaluru — onsite demo",
      workplaceType: "onsite",
      description: "Demo fixture only. Requires pursuit of a computer-science-related degree and production software engineering experience. JavaScript and automated testing are useful. This is intentionally a stretch-role example, not a live vacancy.",
    },
  ];

  const sources = roles.map((role) => ({
    id: role.sourceId,
    provider: "greenhouse",
    companyName: role.company,
    boardToken: role.boardToken,
    companyDomain: role.companyDomain,
    careersUrl: null,
    enabled: 0,
    createdAt: FIXTURE_TIME,
  }));

  const runs = roles.map((role) => ({
    id: `demo_run_${role.slug}`,
    sourceId: role.sourceId,
    idempotencyKey: `demo-fixture-${role.slug}`,
    status: "completed",
    observedAt: FIXTURE_TIME,
    discoveredCount: 1,
    createdCount: 1,
    updatedCount: 0,
    unchangedCount: 0,
    closedCount: 0,
    completedAt: FIXTURE_TIME,
    error: null,
    createdAt: FIXTURE_TIME,
  }));

  const jobs = roles.map((role) => {
    const canonicalUrl = `https://job-boards.greenhouse.io/${role.boardToken}/jobs/${role.externalId}`;
    return {
      id: `demo_job_${role.slug}`,
      source: "greenhouse",
      sourceRegistryId: role.sourceId,
      externalId: role.externalId,
      canonicalUrl,
      company: role.company,
      title: role.title,
      description: role.description,
      location: role.location,
      workplaceType: role.workplaceType,
      score: 0,
      scoreExplanation: JSON.stringify(["Local demo fixture: evaluate with approved-claim resume lens; not live vacancy evidence"]),
      eligibilityRisks: JSON.stringify([]),
      state: "shortlisted",
      lifecycleState: "active",
      fingerprint: `${role.sourceId}|${role.externalId}`,
      postedAt: null,
      firstSeenAt: FIXTURE_TIME,
      lastSeenAt: FIXTURE_TIME,
      closedAt: null,
      missingCount: 0,
      currentSnapshotId: `demo_snapshot_${role.slug}`,
      lastSeenRunId: `demo_run_${role.slug}`,
    };
  });

  const snapshots = jobs.map((job, index) => {
    const role = roles[index];
    const hashBasis = {
      canonicalUrl: job.canonicalUrl,
      company: job.company,
      title: job.title,
      description: job.description,
      location: job.location,
      workplaceType: job.workplaceType,
    };
    return {
      id: `demo_snapshot_${role.slug}`,
      jobId: job.id,
      syncRunId: `demo_run_${role.slug}`,
      version: 1,
      contentHash: demoHash(hashBasis),
      canonicalUrl: job.canonicalUrl,
      company: job.company,
      title: job.title,
      description: job.description,
      location: job.location,
      workplaceType: job.workplaceType,
      score: 0,
      scoreExplanation: job.scoreExplanation,
      eligibilityRisks: job.eligibilityRisks,
      postedAt: null,
      capturedAt: FIXTURE_TIME,
    };
  });

  const evidence = "LOCAL DEMO ONLY — derived from Scout's approved resume-boundary handoff; replace/review against source documents before any external use.";
  const claimStatements = [
    ["demo_claim_education", "Management and Public Policy undergraduate at IIM Sambalpur, expected 2029."],
    ["demo_claim_gmc", "Supported adverse-drug-reaction data review and technical documentation, and conducted desk research on antibiotic price disparities in India."],
    ["demo_claim_hand_hygiene", "Designed a single-site exploratory hand-hygiene pilot and prepared the synopsis, questionnaire and facility checklist; fieldwork is planned to resume."],
    ["demo_claim_cms", "Directed product and design and AI-assisted delivery of a clinic website and CMS, including Git workflows, accessibility checks and deployment QA."],
    ["demo_claim_clinic_ops", "Directed requirements and AI-assisted delivery of a Node.js, Express and SQLite multi-clinic operations prototype, including workflow mapping, edge cases and automated tests."],
    ["demo_claim_scout", "Defined product requirements and the safety model for the Scout internship-copilot prototype and directed TypeScript prototype validation; no autonomous outreach or completed application is claimed."],
    ["demo_claim_policy", "Prepared public-policy coursework analysing local implementation of India's National Action Plan on Antimicrobial Resistance and proposed governance and stewardship measures."],
    ["demo_claim_skills", "Evidence-backed exposure includes product and operations workflow mapping, requirements definition, QA and testing, research synthesis, Excel, Power BI, SPSS, Python, JavaScript, Git and technical documentation."],
  ];

  const claims = claimStatements.map(([id, statement]) => ({
    id,
    statement,
    evidence,
    status: "approved",
    version: 1,
    approvedAt: FIXTURE_TIME,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }));

  return { sources, runs, jobs, snapshots, claims };
}

function insertDemoFixture(database, fixture) {
  const insertSource = database.prepare(`
    INSERT OR IGNORE INTO company_sources (
      id, provider, company_name, board_token, company_domain, careers_url, enabled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const source of fixture.sources) {
    insertSource.run(source.id, source.provider, source.companyName, source.boardToken, source.companyDomain, source.careersUrl, source.enabled, source.createdAt);
  }

  const insertRun = database.prepare(`
    INSERT OR IGNORE INTO sync_runs (
      id, source_id, idempotency_key, status, observed_at, discovered_count, created_count,
      updated_count, unchanged_count, closed_count, completed_at, error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const run of fixture.runs) {
    insertRun.run(run.id, run.sourceId, run.idempotencyKey, run.status, run.observedAt, run.discoveredCount, run.createdCount, run.updatedCount, run.unchangedCount, run.closedCount, run.completedAt, run.error, run.createdAt);
  }

  const insertJob = database.prepare(`
    INSERT OR IGNORE INTO jobs (
      id, source, source_registry_id, external_id, canonical_url, company, title, description,
      location, workplace_type, score, score_explanation, eligibility_risks, state, lifecycle_state,
      fingerprint, posted_at, first_seen_at, last_seen_at, closed_at, missing_count,
      current_snapshot_id, last_seen_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const job of fixture.jobs) {
    insertJob.run(job.id, job.source, job.sourceRegistryId, job.externalId, job.canonicalUrl, job.company, job.title, job.description, job.location, job.workplaceType, job.score, job.scoreExplanation, job.eligibilityRisks, job.state, job.lifecycleState, job.fingerprint, job.postedAt, job.firstSeenAt, job.lastSeenAt, job.closedAt, job.missingCount, job.currentSnapshotId, job.lastSeenRunId);
  }

  const insertSnapshot = database.prepare(`
    INSERT OR IGNORE INTO job_snapshots (
      id, job_id, sync_run_id, version, content_hash, canonical_url, company, title,
      description, location, workplace_type, score, score_explanation, eligibility_risks,
      posted_at, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const snapshot of fixture.snapshots) {
    insertSnapshot.run(snapshot.id, snapshot.jobId, snapshot.syncRunId, snapshot.version, snapshot.contentHash, snapshot.canonicalUrl, snapshot.company, snapshot.title, snapshot.description, snapshot.location, snapshot.workplaceType, snapshot.score, snapshot.scoreExplanation, snapshot.eligibilityRisks, snapshot.postedAt, snapshot.capturedAt);
  }

  const insertClaim = database.prepare(`
    INSERT OR IGNORE INTO candidate_claims (
      id, statement, evidence, status, version, approved_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const claim of fixture.claims) {
    insertClaim.run(claim.id, claim.statement, claim.evidence, claim.status, claim.version, claim.approvedAt, claim.createdAt, claim.updatedAt);
  }
}

function expectRow(database, table, id, expected) {
  const row = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new Error(`Demo seed row ${table}.${id} was not persisted`);
  for (const [column, expectedValue] of Object.entries(expected)) {
    if (row[column] !== expectedValue) {
      throw new Error(
        `Demo seed id ${table}.${id} already exists with conflicting ${column}; reset the local demo database explicitly before reseeding.`,
      );
    }
  }
}

function validateDemoFixture(database, fixture) {
  for (const source of fixture.sources) {
    expectRow(database, "company_sources", source.id, {
      provider: source.provider,
      company_name: source.companyName,
      board_token: source.boardToken,
      company_domain: source.companyDomain,
      enabled: source.enabled,
    });
  }
  for (const job of fixture.jobs) {
    expectRow(database, "jobs", job.id, {
      source_registry_id: job.sourceRegistryId,
      external_id: job.externalId,
      canonical_url: job.canonicalUrl,
      current_snapshot_id: job.currentSnapshotId,
    });
  }
  for (const snapshot of fixture.snapshots) {
    expectRow(database, "job_snapshots", snapshot.id, {
      job_id: snapshot.jobId,
      content_hash: snapshot.contentHash,
    });
  }
  for (const claim of fixture.claims) {
    expectRow(database, "candidate_claims", claim.id, {
      statement: claim.statement,
      evidence: claim.evidence,
      status: claim.status,
      version: claim.version,
    });
  }
}

export function seedLocalDemo(database) {
  assertScoutSchema(database);
  const fixture = buildDemoFixture();
  database.exec("BEGIN IMMEDIATE");
  try {
    insertDemoFixture(database, fixture);
    validateDemoFixture(database, fixture);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    sources: fixture.sources.length,
    jobs: fixture.jobs.length,
    claims: fixture.claims.length,
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function resetLocalDemo(database, { confirmed = false } = {}) {
  assertScoutSchema(database);
  if (!confirmed) {
    throw new Error("Local reset requires --confirm-local-reset because it deletes all rows from the local Scout D1 database");
  }

  const triggerRows = database.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger' AND sql IS NOT NULL
    ORDER BY name
  `).all();

  const originalTriggerNames = new Set(triggerRows.map((row) => row.name));
  for (const required of REQUIRED_TRIGGERS) {
    if (!originalTriggerNames.has(required)) {
      throw new Error(`Refusing reset because safety trigger ${required} is missing`);
    }
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const trigger of triggerRows) database.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
    for (const table of RESET_TABLES) database.exec(`DELETE FROM ${quoteIdentifier(table)}`);
    for (const trigger of triggerRows) database.exec(trigger.sql);

    const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) throw new Error("Foreign-key check failed during local Scout reset");

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  assertScoutSchema(database);
  return Object.fromEntries(RESET_TABLES.map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count]));
}

export function getLocalDemoStatus(database) {
  assertScoutSchema(database);
  const fixture = buildDemoFixture();
  const counts = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count]));
  const demoCounts = {
    sources: database.prepare("SELECT COUNT(*) AS count FROM company_sources WHERE id LIKE 'demo_%'").get().count,
    jobs: database.prepare("SELECT COUNT(*) AS count FROM jobs WHERE id LIKE 'demo_%'").get().count,
    claims: database.prepare("SELECT COUNT(*) AS count FROM candidate_claims WHERE id LIKE 'demo_%'").get().count,
  };
  const expected = { sources: fixture.sources.length, jobs: fixture.jobs.length, claims: fixture.claims.length };
  return { counts, demoCounts, expected };
}

function openLocalDatabase(cwd = process.cwd(), env = process.env) {
  assertSafeLocalDemoEnvironment(env);
  const databasePath = resolveLocalD1Database(cwd);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON");
  return { databasePath, database };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["status", "seed", "reset"].includes(command)) {
    console.error("Usage: node scripts/scout-demo-db.mjs <status|seed|reset> [--confirm-local-reset]");
    process.exitCode = 2;
    return;
  }

  const { databasePath, database } = openLocalDatabase();
  try {
    console.log(`Scout demo database: ${databasePath}`);
    console.log("Mode: LOCAL D1 SQLITE ONLY — no remote API or Wrangler command is used");

    if (command === "status") {
      console.log(JSON.stringify(getLocalDemoStatus(database), null, 2));
      return;
    }
    if (command === "seed") {
      console.log("Seeded:", seedLocalDemo(database));
      console.log("Demo sources are disabled and use reserved .example domains. Demo claims are local-only review fixtures.");
      return;
    }

    const confirmed = args.includes("--confirm-local-reset");
    const result = resetLocalDemo(database, { confirmed });
    console.log("Reset complete. Local Scout rows remaining:", result);
  } finally {
    database.close();
  }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(`Scout demo database error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
