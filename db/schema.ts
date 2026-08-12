import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
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
  state: text("state").notNull().default("discovered"),
  fingerprint: text("fingerprint").notNull(),
  postedAt: text("posted_at"),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_jobs_source_external").on(table.source, table.externalId),
  uniqueIndex("idx_jobs_canonical_url").on(table.canonicalUrl),
]);

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
