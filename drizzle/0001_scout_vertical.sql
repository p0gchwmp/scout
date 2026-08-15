CREATE TABLE `company_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL CHECK (`provider` = 'greenhouse'),
  `company_name` text NOT NULL,
  `board_token` text NOT NULL,
  `company_domain` text NOT NULL,
  `careers_url` text,
  `enabled` integer DEFAULT true NOT NULL CHECK (`enabled` IN (0, 1)),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_company_sources_provider_token` ON `company_sources` (`provider`, `board_token`);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL REFERENCES `company_sources`(`id`),
  `idempotency_key` text NOT NULL,
  `status` text DEFAULT 'running' NOT NULL CHECK (`status` IN ('running', 'completed', 'failed')),
  `observed_at` text NOT NULL,
  `discovered_count` integer DEFAULT 0 NOT NULL,
  `created_count` integer DEFAULT 0 NOT NULL,
  `updated_count` integer DEFAULT 0 NOT NULL,
  `unchanged_count` integer DEFAULT 0 NOT NULL,
  `closed_count` integer DEFAULT 0 NOT NULL,
  `completed_at` text,
  `error` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_runs_source_key` ON `sync_runs` (`source_id`, `idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_runs_one_running_source` ON `sync_runs` (`source_id`) WHERE `status` = 'running';
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `__new_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `source_registry_id` text REFERENCES `company_sources`(`id`),
  `external_id` text NOT NULL,
  `canonical_url` text NOT NULL,
  `company` text NOT NULL,
  `title` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `location` text DEFAULT '' NOT NULL,
  `workplace_type` text DEFAULT 'unspecified' NOT NULL,
  `score` integer DEFAULT 0 NOT NULL,
  `score_explanation` text DEFAULT '[]' NOT NULL,
  `eligibility_risks` text DEFAULT '[]' NOT NULL,
  `state` text DEFAULT 'shortlisted' NOT NULL,
  `lifecycle_state` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_state` IN ('active', 'closed')),
  `fingerprint` text NOT NULL,
  `posted_at` text,
  `first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `closed_at` text,
  `missing_count` integer DEFAULT 0 NOT NULL,
  `current_snapshot_id` text,
  `last_seen_run_id` text REFERENCES `sync_runs`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_jobs` (
  `id`, `source`, `external_id`, `canonical_url`, `company`, `title`, `description`, `location`,
  `workplace_type`, `score`, `score_explanation`, `eligibility_risks`, `state`, `fingerprint`,
  `posted_at`, `first_seen_at`, `last_seen_at`
) SELECT
  `id`, `source`, `external_id`, `canonical_url`, `company`, `title`, `description`, `location`,
  `workplace_type`, `score`, `score_explanation`, `eligibility_risks`, `state`, `fingerprint`,
  `posted_at`, `last_seen_at`, `last_seen_at`
FROM `jobs`;
--> statement-breakpoint
DROP TABLE `jobs`;
--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_canonical_url` ON `jobs` (`canonical_url`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_registry_external` ON `jobs` (`source_registry_id`, `external_id`);
--> statement-breakpoint
CREATE INDEX `idx_jobs_lifecycle_score` ON `jobs` (`lifecycle_state`, `score`);
--> statement-breakpoint
CREATE TABLE `job_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`),
  `sync_run_id` text NOT NULL REFERENCES `sync_runs`(`id`),
  `version` integer NOT NULL,
  `content_hash` text NOT NULL,
  `canonical_url` text NOT NULL,
  `company` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `location` text NOT NULL,
  `workplace_type` text NOT NULL,
  `score` integer NOT NULL,
  `score_explanation` text NOT NULL,
  `eligibility_risks` text NOT NULL,
  `posted_at` text,
  `captured_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_snapshots_job_version` ON `job_snapshots` (`job_id`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_snapshots_job_hash` ON `job_snapshots` (`job_id`, `content_hash`);
--> statement-breakpoint
CREATE TRIGGER `job_snapshots_immutable_update`
BEFORE UPDATE ON `job_snapshots`
BEGIN SELECT RAISE(ABORT, 'job snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `job_snapshots_immutable_delete`
BEFORE DELETE ON `job_snapshots`
BEGIN SELECT RAISE(ABORT, 'job snapshots are immutable'); END;
--> statement-breakpoint
CREATE TABLE `contact_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`),
  `job_snapshot_id` text NOT NULL REFERENCES `job_snapshots`(`id`),
  `email` text NOT NULL,
  `source_url` text NOT NULL,
  `excerpt` text NOT NULL,
  `extracted_at` text NOT NULL,
  `suitability` text NOT NULL CHECK (`suitability` IN ('high', 'review')),
  `suitability_reason` text NOT NULL,
  `review_state` text DEFAULT 'needs_review' NOT NULL CHECK (`review_state` IN ('needs_review', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_evidence_provenance` ON `contact_evidence` (`job_snapshot_id`, `email`, `source_url`);
--> statement-breakpoint
CREATE TRIGGER `contact_evidence_snapshot_job_match`
BEFORE INSERT ON `contact_evidence`
WHEN NOT EXISTS (
  SELECT 1 FROM `job_snapshots` s
  WHERE s.`id` = NEW.`job_snapshot_id` AND s.`job_id` = NEW.`job_id`
)
BEGIN SELECT RAISE(ABORT, 'contact evidence job must match snapshot job'); END;
--> statement-breakpoint
CREATE TRIGGER `contact_evidence_provenance_immutable`
BEFORE UPDATE OF `job_id`, `job_snapshot_id`, `email`, `source_url`, `excerpt`, `extracted_at`, `suitability`, `suitability_reason` ON `contact_evidence`
BEGIN SELECT RAISE(ABORT, 'contact evidence provenance is immutable'); END;
--> statement-breakpoint
CREATE TABLE `candidate_claims` (
  `id` text PRIMARY KEY NOT NULL,
  `statement` text NOT NULL,
  `evidence` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft', 'approved', 'rejected')),
  `version` integer DEFAULT 1 NOT NULL,
  `approved_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `candidate_claims_approved_immutable_update`
BEFORE UPDATE ON `candidate_claims`
WHEN OLD.`status` = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved candidate claims are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `candidate_claims_approved_immutable_delete`
BEFORE DELETE ON `candidate_claims`
WHEN OLD.`status` = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved candidate claims are immutable'); END;
--> statement-breakpoint
CREATE TABLE `outreach_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`),
  `state` text DEFAULT 'draft' NOT NULL CHECK (`state` IN ('draft', 'approved', 'rejected')),
  `approved_revision_id` text,
  `approved_at` text,
  `rejected_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outreach_draft_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `draft_id` text NOT NULL REFERENCES `outreach_drafts`(`id`),
  `version` integer NOT NULL,
  `template_version` integer DEFAULT 1 NOT NULL,
  `job_snapshot_id` text NOT NULL REFERENCES `job_snapshots`(`id`),
  `contact_id` text NOT NULL REFERENCES `contact_evidence`(`id`),
  `claim_ids` text NOT NULL,
  `body` text NOT NULL,
  `body_hash` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_outreach_revisions_draft_version` ON `outreach_draft_revisions` (`draft_id`, `version`);
--> statement-breakpoint
CREATE TRIGGER `outreach_revisions_immutable_update`
BEFORE UPDATE ON `outreach_draft_revisions`
BEGIN SELECT RAISE(ABORT, 'outreach revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `outreach_revisions_immutable_delete`
BEFORE DELETE ON `outreach_draft_revisions`
BEGIN SELECT RAISE(ABORT, 'outreach revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `outreach_revisions_require_draft`
BEFORE INSERT ON `outreach_draft_revisions`
WHEN (SELECT `state` FROM `outreach_drafts` WHERE `id` = NEW.`draft_id`) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'only draft records accept revisions'); END;
--> statement-breakpoint
CREATE TRIGGER `outreach_revisions_require_current_accepted_evidence`
BEFORE INSERT ON `outreach_draft_revisions`
WHEN
  NOT json_valid(NEW.`claim_ids`)
  OR json_array_length(NEW.`claim_ids`) = 0
  OR NOT EXISTS (
    SELECT 1 FROM `outreach_drafts` d
    JOIN `jobs` j ON j.`id` = d.`job_id`
    JOIN `contact_evidence` c ON c.`id` = NEW.`contact_id`
    WHERE d.`id` = NEW.`draft_id`
      AND d.`state` = 'draft'
      AND j.`current_snapshot_id` = NEW.`job_snapshot_id`
      AND c.`job_id` = d.`job_id`
      AND c.`job_snapshot_id` = NEW.`job_snapshot_id`
      AND c.`review_state` = 'accepted'
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.`claim_ids`) pins
    LEFT JOIN `candidate_claims` c ON c.`id` = pins.`value`
    WHERE c.`id` IS NULL OR c.`status` <> 'approved'
  )
BEGIN SELECT RAISE(ABORT, 'revision pins stale or unaccepted evidence'); END;
--> statement-breakpoint
CREATE TRIGGER `outreach_drafts_approval_revalidate`
BEFORE UPDATE OF `state`, `approved_revision_id` ON `outreach_drafts`
WHEN NEW.`state` = 'approved'
BEGIN
  SELECT CASE WHEN OLD.`state` <> 'draft' THEN RAISE(ABORT, 'only drafts can be approved') END;
  SELECT CASE WHEN NEW.`approved_revision_id` IS NULL THEN RAISE(ABORT, 'approved revision is required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `outreach_draft_revisions` r
    JOIN `jobs` j ON j.`id` = NEW.`job_id`
    JOIN `contact_evidence` c ON c.`id` = r.`contact_id`
    WHERE r.`id` = NEW.`approved_revision_id`
      AND r.`draft_id` = NEW.`id`
      AND r.`version` = (SELECT MAX(latest.`version`) FROM `outreach_draft_revisions` latest WHERE latest.`draft_id` = NEW.`id`)
      AND j.`current_snapshot_id` = r.`job_snapshot_id`
      AND c.`job_id` = NEW.`job_id`
      AND c.`job_snapshot_id` = r.`job_snapshot_id`
      AND c.`review_state` = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(r.`claim_ids`) pins
        LEFT JOIN `candidate_claims` claim ON claim.`id` = pins.`value`
        WHERE claim.`id` IS NULL OR claim.`status` <> 'approved'
      )
  ) THEN RAISE(ABORT, 'draft approval bindings are stale') END;
END;
--> statement-breakpoint
CREATE TRIGGER `outreach_drafts_approved_immutable`
BEFORE UPDATE ON `outreach_drafts`
WHEN OLD.`state` = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved drafts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `contact_evidence_approved_pin_immutable_update`
BEFORE UPDATE ON `contact_evidence`
WHEN EXISTS (
  SELECT 1 FROM `outreach_drafts` d
  JOIN `outreach_draft_revisions` r ON r.`id` = d.`approved_revision_id`
  WHERE d.`state` = 'approved' AND r.`contact_id` = OLD.`id`
)
BEGIN SELECT RAISE(ABORT, 'approved contact evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `contact_evidence_approved_pin_immutable_delete`
BEFORE DELETE ON `contact_evidence`
WHEN EXISTS (
  SELECT 1 FROM `outreach_drafts` d
  JOIN `outreach_draft_revisions` r ON r.`id` = d.`approved_revision_id`
  WHERE d.`state` = 'approved' AND r.`contact_id` = OLD.`id`
)
BEGIN SELECT RAISE(ABORT, 'approved contact evidence is immutable'); END;
