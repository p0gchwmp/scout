import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  buildDemoWorkflowFixture,
  getLocalDemoWorkflowStatus,
  seedLocalDemoWorkflow,
} from "../scripts/scout-demo-workflow.mjs";
import { buildDemoFixture, resetLocalDemo } from "../scripts/scout-demo-db.mjs";

function applyScoutMigrations(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys=ON");
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
    entries?: Array<{ tag?: unknown }>;
  };
  const tags = (journal.entries ?? []).map((entry) => entry.tag).filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
  assert.ok(tags.length > 0, "Drizzle migration journal must contain Scout migrations");
  for (const tag of tags) {
    const sql = readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
    database.exec(sql);
  }
}

function createDatabase() {
  const root = mkdtempSync(join(tmpdir(), "scout-demo-workflow-"));
  const d1Directory = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
  mkdirSync(d1Directory, { recursive: true });
  const database = new DatabaseSync(join(d1Directory, "demo.sqlite"));
  applyScoutMigrations(database);
  return { root, database };
}

const expectedCounts = {
  sources: 3,
  jobs: 3,
  claims: 8,
  profileFields: 6,
  contacts: 2,
  outreachDrafts: 1,
  outreachRevisions: 1,
  applications: 1,
};

test("complete local demo workflow is deterministic and review-only", () => {
  const { root, database } = createDatabase();
  try {
    assert.deepEqual(seedLocalDemoWorkflow(database), expectedCounts);
    assert.deepEqual(seedLocalDemoWorkflow(database), expectedCounts);

    const status = getLocalDemoWorkflowStatus(database);
    assert.deepEqual(status.workflowCounts, {
      profileFields: 6,
      contacts: 2,
      outreachDrafts: 1,
      outreachRevisions: 1,
      applications: 1,
    });
    assert.deepEqual(status.expectedWorkflow, status.workflowCounts);

    const contacts = database.prepare("SELECT id, email, source_url, review_state FROM contact_evidence WHERE id LIKE 'demo_%' ORDER BY id").all();
    assert.equal(contacts.length, 2);
    assert.ok(contacts.every((contact) => String(contact.email).endsWith(".example")));
    assert.ok(contacts.every((contact) => new URL(String(contact.source_url)).hostname.endsWith(".example")));
    assert.ok(contacts.some((contact) => contact.review_state === "accepted"));
    assert.ok(contacts.some((contact) => contact.review_state === "needs_review"));

    const revision = database.prepare("SELECT contact_id, job_snapshot_id, claim_ids, body, body_hash, template_version FROM outreach_draft_revisions WHERE id = 'demo_outreach_health_v1'").get();
    const accepted = database.prepare("SELECT review_state FROM contact_evidence WHERE id = ?").get(revision.contact_id);
    assert.equal(accepted.review_state, "accepted");
    assert.equal(revision.job_snapshot_id, "demo_snapshot_health");
    assert.equal(revision.template_version, 3);
    assert.deepEqual(JSON.parse(String(revision.claim_ids)), ["demo_claim_clinic_ops", "demo_claim_scout", "demo_claim_skills"]);
    assert.match(String(revision.body), /internships@demo-health\.example/);
    assert.equal(String(revision.body_hash).length, 64);

    const draft = database.prepare("SELECT state, approved_revision_id, approved_at, rejected_at FROM outreach_drafts WHERE id = 'demo_outreach_health'").get();
    assert.equal(draft.state, "draft");
    assert.equal(draft.approved_revision_id, null);
    assert.equal(draft.approved_at, null);
    assert.equal(draft.rejected_at, null);

    const application = database.prepare("SELECT status, approved_at, submitted_at, confirmation_url, artifact_version, submitted_fields FROM applications WHERE id = 'demo_application_health'").get();
    assert.equal(application.status, "ready_for_review");
    assert.equal(application.approved_at, null);
    assert.equal(application.submitted_at, null);
    assert.equal(application.confirmation_url, null);
    assert.equal(application.artifact_version, 1);
    const packet = JSON.parse(String(application.submitted_fields));
    assert.equal(packet.externalSideEffect, false);
    assert.equal(packet.channel.id, "greenhouse");
    assert.equal(packet.channel.automation, "structured");
    assert.equal(packet.availability?.lane, "compatible_now");
    assert.equal(packet.requiredProfileKeys.length, 6);
    assert.equal(packet.profileBindings.length, 6);
    assert.ok(packet.profileBindings.every((binding: { id?: string; kind?: string; updatedAt?: string }) => binding.id && binding.kind && binding.updatedAt));

    const approvedDemoClaimIds = new Set(buildDemoFixture().claims.filter((claim) => claim.status === "approved").map((claim) => claim.id));
    assert.ok(packet.claimIds.length > 0 && packet.claimIds.length <= 6);
    assert.ok(packet.claimIds.every((id: string) => approvedDemoClaimIds.has(id)));
    assert.equal(new Set(packet.claimIds).size, packet.claimIds.length);
    assert.equal(packet.claimStatements.length, packet.claimIds.length);

    assert.equal(packet.review.synthetic, true);
    assert.equal(packet.review.applicationReview.humanReviewRequired, true);
    assert.equal(packet.review.outreachReview.state, "contact_accepted");
    assert.equal(packet.review.outreachReview.sendAvailable, false);
    assert.equal(packet.review.safety.submitApplication, false);
    assert.equal(packet.review.safety.sendOutreach, false);
    assert.match(packet.review.note, /nothing was submitted/i);
    assert.ok(String(packet.safeFields.email).endsWith("@example.com"));

    assert.throws(() => resetLocalDemo(database), /--confirm-local-reset/);
    const reset = resetLocalDemo(database, { confirmed: true });
    assert.ok(Object.values(reset).every((count) => count === 0));
    assert.deepEqual(seedLocalDemoWorkflow(database), expectedCounts);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("workflow fixture preserves provenance and never binds outreach to needs-review contact", () => {
  const fixture = buildDemoWorkflowFixture();
  const accepted = fixture.contacts.find((contact) => contact.reviewState === "accepted");
  const needsReview = fixture.contacts.find((contact) => contact.reviewState === "needs_review");
  assert.ok(accepted);
  assert.ok(needsReview);
  assert.equal(fixture.outreachRevisions[0].contactId, accepted.id);
  assert.notEqual(fixture.outreachRevisions[0].contactId, needsReview.id);
  assert.equal(fixture.outreachRevisions[0].jobSnapshotId, accepted.jobSnapshotId);
  assert.ok(fixture.contacts.every((contact) => contact.sourceUrl.includes(".example/")));
});

test("complete demo workflow script has no network or external-side-effect execution path", () => {
  const script = readFileSync(new URL("../scripts/scout-demo-workflow.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /node:child_process/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /cloudflare:workers/);
  assert.doesNotMatch(script, /--remote/);
  assert.doesNotMatch(script, /gmail/i);
  assert.doesNotMatch(script, /sendMail|messages\.send|applications?\/submit/i);
});
