import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  assertSafeLocalDemoEnvironment,
  assertScoutSchema,
  buildDemoFixture,
  getLocalDemoStatus,
  resetLocalDemo,
  resolveLocalD1Database,
  seedLocalDemo,
} from "./scout-demo-db.mjs";
import { buildApplicationPreparation } from "../lib/scout/application-prep.ts";
import { assessApplicationReadiness } from "../lib/scout/application-readiness.ts";
import { buildApplicationReviewPacket } from "../lib/scout/application-review-packet.ts";
import { assessOpportunityFit } from "../lib/scout/opportunity-fit.ts";
import { assessOpportunityQuality } from "../lib/scout/opportunity-quality-intelligence.ts";
import { OUTREACH_TEMPLATE_VERSION, renderOutreachDraft } from "../lib/scout/outreach.ts";

const FIXTURE_TIME = "2026-08-23T00:00:00.000Z";
const HEALTH_JOB_ID = "demo_job_health";
const HEALTH_SNAPSHOT_ID = "demo_snapshot_health";
const ACCEPTED_CONTACT_ID = "demo_contact_health_accepted";
const OUTREACH_DRAFT_ID = "demo_outreach_health";
const OUTREACH_REVISION_ID = "demo_outreach_health_v1";
const APPLICATION_ID = "demo_application_health";
const OUTREACH_CLAIM_IDS = ["demo_claim_clinic_ops", "demo_claim_scout", "demo_claim_skills"];

function bodyHash(body) {
  return createHash("sha256").update(body).digest("hex");
}

function jsonArray(value) {
  try { return Array.isArray(value) ? value : JSON.parse(String(value)); }
  catch { return []; }
}

export function buildDemoWorkflowFixture() {
  const base = buildDemoFixture();
  const healthJobRaw = base.jobs.find((job) => job.id === HEALTH_JOB_ID);
  const healthSnapshotRaw = base.snapshots.find((snapshot) => snapshot.id === HEALTH_SNAPSHOT_ID);
  const healthSourceRaw = base.sources.find((source) => source.id === healthJobRaw?.sourceRegistryId);
  if (!healthJobRaw || !healthSnapshotRaw || !healthSourceRaw) throw new Error("Base Scout demo health fixture is incomplete");

  const profileEvidenceNote = "LOCAL DEMO ONLY — synthetic profile evidence for Scout first-run rehearsal; verify before any external use.";
  const profileFields = [
    ["demo_profile_full_name", "full_name", "Ryan Vivek Mahajan"],
    ["demo_profile_email", "email", "ryan.scout-demo@example.com"],
    ["demo_profile_current_location", "current_location", "Jammu, India"],
    ["demo_profile_university", "university", "IIM Sambalpur"],
    ["demo_profile_program", "program", "B.S. in Management and Public Policy"],
    ["demo_profile_resume_reference", "resume_reference", "LOCAL DEMO RESUME — not an external application artifact"],
  ].map(([id, kind, claim]) => ({ id, kind, claim, evidence: profileEvidenceNote, verified: true, updatedAt: FIXTURE_TIME }));

  const contacts = [
    {
      id: ACCEPTED_CONTACT_ID,
      jobId: HEALTH_JOB_ID,
      jobSnapshotId: HEALTH_SNAPSHOT_ID,
      email: "internships@demo-health.example",
      sourceUrl: "https://demo-health.example/careers",
      excerpt: "LOCAL DEMO ONLY — published careers contact for internship questions.",
      sourceType: "official_careers",
      extractedAt: FIXTURE_TIME,
      suitability: "high",
      suitabilityReason: "Synthetic company-domain careers address reserved for local review rehearsal.",
      reviewState: "accepted",
    },
    {
      id: "demo_contact_policy_review",
      jobId: "demo_job_policy",
      jobSnapshotId: "demo_snapshot_policy",
      email: "careers@demo-policy.example",
      sourceUrl: "https://demo-policy.example/contact",
      excerpt: "LOCAL DEMO ONLY — public contact awaiting owner review.",
      sourceType: "official_contact",
      extractedAt: FIXTURE_TIME,
      suitability: "review",
      suitabilityReason: "Synthetic public business contact intentionally left unaccepted for review-queue rehearsal.",
      reviewState: "needs_review",
    },
  ];

  const selectedClaims = OUTREACH_CLAIM_IDS.map((id) => base.claims.find((claim) => claim.id === id)).filter(Boolean);
  if (selectedClaims.length !== OUTREACH_CLAIM_IDS.length) throw new Error("Base Scout demo approved claims are incomplete");
  const rendered = renderOutreachDraft({
    candidateName: "Ryan Vivek Mahajan",
    companyName: healthJobRaw.company,
    roleTitle: healthJobRaw.title,
    contactEmail: contacts[0].email,
    jobSnapshotId: HEALTH_SNAPSHOT_ID,
    contactId: ACCEPTED_CONTACT_ID,
    claims: selectedClaims.map((claim) => ({ id: claim.id, statement: claim.statement })),
  });

  const outreachDrafts = [{
    id: OUTREACH_DRAFT_ID,
    jobId: HEALTH_JOB_ID,
    state: "draft",
    approvedRevisionId: null,
    approvedAt: null,
    rejectedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }];
  const outreachRevisions = [{
    id: OUTREACH_REVISION_ID,
    draftId: OUTREACH_DRAFT_ID,
    version: 1,
    templateVersion: OUTREACH_TEMPLATE_VERSION,
    jobSnapshotId: HEALTH_SNAPSHOT_ID,
    contactId: ACCEPTED_CONTACT_ID,
    claimIds: JSON.stringify(rendered.claimIds),
    body: rendered.body,
    bodyHash: bodyHash(rendered.body),
    createdAt: FIXTURE_TIME,
  }];

  const evidenceJob = {
    ...healthJobRaw,
    scoreExplanation: jsonArray(healthJobRaw.scoreExplanation),
    eligibilityRisks: jsonArray(healthJobRaw.eligibilityRisks),
  };
  const snapshot = {
    ...healthSnapshotRaw,
    scoreExplanation: jsonArray(healthSnapshotRaw.scoreExplanation),
    eligibilityRisks: jsonArray(healthSnapshotRaw.eligibilityRisks),
  };
  const source = { ...healthSourceRaw, registered: true };
  const quality = assessOpportunityQuality(evidenceJob, source);
  const fit = assessOpportunityFit(evidenceJob, quality);
  const readiness = assessApplicationReadiness({ job: evidenceJob, profileFields, claims: base.claims });
  const prepared = buildApplicationPreparation({
    job: evidenceJob,
    profileFields,
    claims: base.claims,
    relevantClaimIds: readiness.claimIds,
  });
  const review = buildApplicationReviewPacket({
    snapshot: {
      id: snapshot.id,
      canonicalUrl: snapshot.canonicalUrl,
      company: snapshot.company,
      title: snapshot.title,
      description: snapshot.description,
      location: snapshot.location,
      workplaceType: snapshot.workplaceType,
      postedAt: snapshot.postedAt,
      eligibilityRisks: snapshot.eligibilityRisks,
    },
    quality,
    fit,
    readiness,
    claims: base.claims,
    contacts,
    generatedAt: FIXTURE_TIME,
  });
  const applications = [{
    id: APPLICATION_ID,
    jobId: HEALTH_JOB_ID,
    status: prepared.status,
    approvedAt: null,
    submittedAt: null,
    blockers: JSON.stringify(prepared.blockers),
    submittedFields: JSON.stringify({ ...prepared.packet, review: { ...review, synthetic: true, note: "LOCAL DEMO ONLY — prepared for review; nothing was submitted." } }),
    confirmationUrl: null,
    artifactVersion: 1,
    createdAt: FIXTURE_TIME,
  }];

  return { profileFields, contacts, outreachDrafts, outreachRevisions, applications };
}

function expectRow(database, table, id, expected) {
  const row = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new Error(`Demo workflow row ${table}.${id} was not persisted`);
  for (const [column, expectedValue] of Object.entries(expected)) {
    if (row[column] !== expectedValue) {
      throw new Error(`Demo workflow row ${table}.${id} conflicts on ${column}; reset the local demo database explicitly before reseeding.`);
    }
  }
}

function insertWorkflowFixture(database, fixture) {
  const profileInsert = database.prepare(`INSERT OR IGNORE INTO profile_evidence (id, kind, claim, evidence, verified, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const field of fixture.profileFields) profileInsert.run(field.id, field.kind, field.claim, field.evidence, field.verified ? 1 : 0, field.updatedAt);

  const contactInsert = database.prepare(`INSERT OR IGNORE INTO contact_evidence (id, job_id, job_snapshot_id, email, source_url, excerpt, source_type, extracted_at, suitability, suitability_reason, review_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const contact of fixture.contacts) contactInsert.run(contact.id, contact.jobId, contact.jobSnapshotId, contact.email, contact.sourceUrl, contact.excerpt, contact.sourceType, contact.extractedAt, contact.suitability, contact.suitabilityReason, contact.reviewState);

  const draftInsert = database.prepare(`INSERT OR IGNORE INTO outreach_drafts (id, job_id, state, approved_revision_id, approved_at, rejected_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const draft of fixture.outreachDrafts) draftInsert.run(draft.id, draft.jobId, draft.state, draft.approvedRevisionId, draft.approvedAt, draft.rejectedAt, draft.createdAt, draft.updatedAt);

  const revisionInsert = database.prepare(`INSERT OR IGNORE INTO outreach_draft_revisions (id, draft_id, version, template_version, job_snapshot_id, contact_id, claim_ids, body, body_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const revision of fixture.outreachRevisions) revisionInsert.run(revision.id, revision.draftId, revision.version, revision.templateVersion, revision.jobSnapshotId, revision.contactId, revision.claimIds, revision.body, revision.bodyHash, revision.createdAt);

  const applicationInsert = database.prepare(`INSERT OR IGNORE INTO applications (id, job_id, status, approved_at, submitted_at, blockers, submitted_fields, confirmation_url, artifact_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const application of fixture.applications) applicationInsert.run(application.id, application.jobId, application.status, application.approvedAt, application.submittedAt, application.blockers, application.submittedFields, application.confirmationUrl, application.artifactVersion, application.createdAt);
}

function validateWorkflowFixture(database, fixture) {
  for (const field of fixture.profileFields) expectRow(database, "profile_evidence", field.id, { kind: field.kind, claim: field.claim, verified: 1 });
  for (const contact of fixture.contacts) expectRow(database, "contact_evidence", contact.id, { job_id: contact.jobId, job_snapshot_id: contact.jobSnapshotId, email: contact.email, source_url: contact.sourceUrl, review_state: contact.reviewState });
  for (const draft of fixture.outreachDrafts) expectRow(database, "outreach_drafts", draft.id, { job_id: draft.jobId, state: draft.state, approved_revision_id: null });
  for (const revision of fixture.outreachRevisions) expectRow(database, "outreach_draft_revisions", revision.id, { draft_id: revision.draftId, job_snapshot_id: revision.jobSnapshotId, contact_id: revision.contactId, claim_ids: revision.claimIds, body_hash: revision.bodyHash });
  for (const application of fixture.applications) expectRow(database, "applications", application.id, { job_id: application.jobId, status: application.status, submitted_at: null, confirmation_url: null, artifact_version: application.artifactVersion });
}

export function seedLocalDemoWorkflow(database) {
  assertScoutSchema(database);
  const base = seedLocalDemo(database);
  const fixture = buildDemoWorkflowFixture();
  database.exec("BEGIN IMMEDIATE");
  try {
    insertWorkflowFixture(database, fixture);
    validateWorkflowFixture(database, fixture);
    if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Foreign-key check failed while seeding the local Scout workflow demo");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { ...base, profileFields: fixture.profileFields.length, contacts: fixture.contacts.length, outreachDrafts: fixture.outreachDrafts.length, outreachRevisions: fixture.outreachRevisions.length, applications: fixture.applications.length };
}

export function getLocalDemoWorkflowStatus(database) {
  const base = getLocalDemoStatus(database);
  const fixture = buildDemoWorkflowFixture();
  const workflowCounts = {
    profileFields: database.prepare("SELECT COUNT(*) AS count FROM profile_evidence WHERE id LIKE 'demo_%'").get().count,
    contacts: database.prepare("SELECT COUNT(*) AS count FROM contact_evidence WHERE id LIKE 'demo_%'").get().count,
    outreachDrafts: database.prepare("SELECT COUNT(*) AS count FROM outreach_drafts WHERE id LIKE 'demo_%'").get().count,
    outreachRevisions: database.prepare("SELECT COUNT(*) AS count FROM outreach_draft_revisions WHERE id LIKE 'demo_%'").get().count,
    applications: database.prepare("SELECT COUNT(*) AS count FROM applications WHERE id LIKE 'demo_%'").get().count,
  };
  const expectedWorkflow = { profileFields: fixture.profileFields.length, contacts: fixture.contacts.length, outreachDrafts: fixture.outreachDrafts.length, outreachRevisions: fixture.outreachRevisions.length, applications: fixture.applications.length };
  return { ...base, workflowCounts, expectedWorkflow };
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
    console.error("Usage: node --experimental-strip-types scripts/scout-demo-workflow.mjs <status|seed|reset> [--confirm-local-reset]");
    process.exitCode = 2;
    return;
  }
  const { databasePath, database } = openLocalDatabase();
  try {
    console.log(`Scout complete demo workflow database: ${databasePath}`);
    console.log("Mode: LOCAL D1 SQLITE ONLY — synthetic .example data; no remote API, email send, or application submit path");
    if (command === "status") return console.log(JSON.stringify(getLocalDemoWorkflowStatus(database), null, 2));
    if (command === "seed") {
      console.log("Seeded:", seedLocalDemoWorkflow(database));
      return console.log("Demo contact/outreach/application rows are review fixtures only. Nothing is sent or submitted.");
    }
    console.log("Reset complete. Local Scout rows remaining:", resetLocalDemo(database, { confirmed: args.includes("--confirm-local-reset") }));
  } finally { database.close(); }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main().catch((error) => {
  console.error(`Scout complete demo workflow error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
