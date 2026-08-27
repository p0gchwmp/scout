import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const companyOutreachTargets = sqliteTable("company_outreach_targets", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull(),
  companyDomain: text("company_domain").notNull(),
  officialUrl: text("official_url").notNull(),
  track: text("track").$type<"now_remote" | "summer_2027">().notNull(),
  interestNote: text("interest_note"),
  state: text("state").$type<"active" | "archived">().notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_company_outreach_targets_domain_track").on(table.companyDomain, table.track),
]);

export const companyOutreachContacts = sqliteTable("company_outreach_contacts", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull().references(() => companyOutreachTargets.id),
  email: text("email").notNull(),
  sourceUrl: text("source_url").notNull(),
  excerpt: text("excerpt").notNull(),
  sourceType: text("source_type").$type<"official_careers" | "official_contact" | "official_company">().notNull(),
  extractedAt: text("extracted_at").notNull(),
  suitability: text("suitability").$type<"review" | "high">().notNull().default("review"),
  suitabilityReason: text("suitability_reason").notNull(),
  reviewState: text("review_state").$type<"needs_review" | "accepted" | "rejected">().notNull().default("needs_review"),
}, (table) => [
  uniqueIndex("idx_company_outreach_contacts_provenance").on(table.targetId, table.email, table.sourceUrl),
]);

export const companyOutreachDrafts = sqliteTable("company_outreach_drafts", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull().references(() => companyOutreachTargets.id),
  state: text("state").$type<"draft" | "approved" | "rejected">().notNull().default("draft"),
  approvedRevisionId: text("approved_revision_id"),
  approvedAt: text("approved_at"),
  rejectedAt: text("rejected_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const companyOutreachDraftRevisions = sqliteTable("company_outreach_draft_revisions", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => companyOutreachDrafts.id),
  targetId: text("target_id").notNull().references(() => companyOutreachTargets.id),
  version: integer("version").notNull(),
  templateVersion: integer("template_version").notNull().default(1),
  contactId: text("contact_id").notNull().references(() => companyOutreachContacts.id),
  claimIds: text("claim_ids", { mode: "json" }).$type<string[]>().notNull(),
  body: text("body").notNull(),
  bodyHash: text("body_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_company_outreach_revisions_draft_version").on(table.draftId, table.version),
]);
