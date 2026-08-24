import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const companySources = sqliteTable("company_sources", {
  id: text("id").primaryKey(),
  provider: text("provider").$type<"greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters">().notNull(),
  companyName: text("company_name").notNull(),
  boardToken: text("board_token").notNull(),
  companyDomain: text("company_domain").notNull(),
  careersUrl: text("careers_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_company_sources_provider_token").on(table.provider, table.boardToken)]);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => companySources.id),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").$type<"running" | "completed" | "failed">().notNull().default("running"),
  observedAt: text("observed_at").notNull(),
  discoveredCount: integer("discovered_count").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  closedCount: integer("closed_count").notNull().default(0),
  completedAt: text("completed_at"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_sync_runs_source_key").on(table.sourceId, table.idempotencyKey),
  uniqueIndex("idx_sync_runs_one_running_source").on(table.sourceId).where(sql`${table.status} = 'running'`),
]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  sourceRegistryId: text("source_registry_id").references(() => companySources.id),
  externalId: text("external_id").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  location: text("location").notNull().default(""),
  workplaceType: text("workplace_type").notNull().default("unspecified"),
  score: integer("score").notNull().default(0),
  scoreExplanation: text("score_explanation", { mode: "json" }).$type<string[]>().notNull().default([]),
  eligibilityRisks: text("eligibility_risks", { mode: "json" }).$type<string[]>().notNull().default([]),
  state: text("state").notNull().default("shortlisted"),
  lifecycleState: text("lifecycle_state").$type<"active" | "closed">().notNull().default("active"),
  fingerprint: text("fingerprint").notNull(),
  postedAt: text("posted_at"),
  firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
  missingCount: integer("missing_count").notNull().default(0),
  currentSnapshotId: text("current_snapshot_id"),
  lastSeenRunId: text("last_seen_run_id").references(() => syncRuns.id),
}, (table) => [
  uniqueIndex("idx_jobs_canonical_url").on(table.canonicalUrl),
  uniqueIndex("idx_jobs_registry_external").on(table.sourceRegistryId, table.externalId),
  index("idx_jobs_lifecycle_score").on(table.lifecycleState, table.score),
]);

export const jobSnapshots = sqliteTable("job_snapshots", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  syncRunId: text("sync_run_id").notNull().references(() => syncRuns.id),
  version: integer("version").notNull(),
  contentHash: text("content_hash").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  location: text("location").notNull(),
  workplaceType: text("workplace_type").notNull(),
  score: integer("score").notNull(),
  scoreExplanation: text("score_explanation", { mode: "json" }).$type<string[]>().notNull(),
  eligibilityRisks: text("eligibility_risks", { mode: "json" }).$type<string[]>().notNull(),
  postedAt: text("posted_at"),
  capturedAt: text("captured_at").notNull(),
}, (table) => [
  uniqueIndex("idx_job_snapshots_job_version").on(table.jobId, table.version),
  uniqueIndex("idx_job_snapshots_job_hash").on(table.jobId, table.contentHash),
]);

export const contactEvidence = sqliteTable("contact_evidence", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  jobSnapshotId: text("job_snapshot_id").notNull().references(() => jobSnapshots.id),
  email: text("email").notNull(),
  sourceUrl: text("source_url").notNull(),
  excerpt: text("excerpt").notNull(),
  sourceType: text("source_type").$type<"official_job_posting" | "official_careers" | "official_contact" | "official_company" | "official_team" | "official_event" | "official_press">().notNull().default("official_job_posting"),
  extractedAt: text("extracted_at").notNull(),
  suitability: text("suitability").$type<"high" | "review">().notNull(),
  suitabilityReason: text("suitability_reason").notNull(),
  reviewState: text("review_state").$type<"needs_review" | "accepted" | "rejected">().notNull().default("needs_review"),
}, (table) => [uniqueIndex("idx_contact_evidence_provenance").on(table.jobSnapshotId, table.email, table.sourceUrl)]);

export const candidateClaims = sqliteTable("candidate_claims", {
  id: text("id").primaryKey(),
  statement: text("statement").notNull(),
  evidence: text("evidence").notNull(),
  status: text("status").$type<"draft" | "approved" | "rejected">().notNull().default("draft"),
  version: integer("version").notNull().default(1),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const outreachDrafts = sqliteTable("outreach_drafts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  state: text("state").$type<"draft" | "approved" | "rejected">().notNull().default("draft"),
  approvedRevisionId: text("approved_revision_id"),
  approvedAt: text("approved_at"),
  rejectedAt: text("rejected_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const outreachDraftRevisions = sqliteTable("outreach_draft_revisions", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => outreachDrafts.id),
  version: integer("version").notNull(),
  templateVersion: integer("template_version").notNull().default(1),
  jobSnapshotId: text("job_snapshot_id").notNull().references(() => jobSnapshots.id),
  contactId: text("contact_id").notNull().references(() => contactEvidence.id),
  claimIds: text("claim_ids", { mode: "json" }).$type<string[]>().notNull(),
  body: text("body").notNull(),
  bodyHash: text("body_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_outreach_revisions_draft_version").on(table.draftId, table.version)]);

// Legacy tables remain readable for migration compatibility. New Scout routes never
// create application records or perform submission/apply side effects.
export const applications = sqliteTable("applications", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  status: text("status").notNull().default("shortlisted"),
  approvedAt: text("approved_at"),
  submittedAt: text("submitted_at"),
  blockers: text("blockers", { mode: "json" }).$type<string[]>().notNull().default([]),
  submittedFields: text("submitted_fields", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  confirmationUrl: text("confirmation_url"),
  artifactVersion: integer("artifact_version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_applications_job").on(table.jobId)]);

export const profileEvidence = sqliteTable("profile_evidence", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  claim: text("claim").notNull(),
  evidence: text("evidence").notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
