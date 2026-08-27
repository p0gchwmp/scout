CREATE TABLE `company_outreach_targets` (
  `id` text PRIMARY KEY NOT NULL,
  `company_name` text NOT NULL,
  `company_domain` text NOT NULL,
  `official_url` text NOT NULL,
  `track` text NOT NULL CHECK (`track` IN ('now_remote', 'summer_2027')),
  `interest_note` text,
  `state` text DEFAULT 'active' NOT NULL CHECK (`state` IN ('active', 'archived')),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_company_outreach_targets_domain_track` ON `company_outreach_targets` (`company_domain`, `track`);
--> statement-breakpoint
CREATE TRIGGER `company_outreach_target_identity_immutable`
BEFORE UPDATE OF `company_name`, `company_domain`, `official_url`, `track`, `interest_note` ON `company_outreach_targets`
BEGIN SELECT RAISE(ABORT, 'company outreach target identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `company_outreach_target_delete_guard`
BEFORE DELETE ON `company_outreach_targets`
WHEN EXISTS (SELECT 1 FROM `company_outreach_contacts` c WHERE c.`target_id` = OLD.`id`)
  OR EXISTS (SELECT 1 FROM `company_outreach_drafts` d WHERE d.`target_id` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'company outreach target with evidence cannot be deleted'); END;
--> statement-breakpoint
CREATE TABLE `company_outreach_contacts` (
  `id` text PRIMARY KEY NOT NULL,
  `target_id` text NOT NULL REFERENCES `company_outreach_targets`(`id`),
  `email` text NOT NULL,
  `source_url` text NOT NULL,
  `excerpt` text NOT NULL,
  `source_type` text NOT NULL CHECK (`source_type` IN ('official_careers', 'official_contact', 'official_company')),
  `extracted_at` text NOT NULL,
  `suitability` text DEFAULT 'review' NOT NULL CHECK (`suitability` IN ('review', 'high')),
  `suitability_reason` text NOT NULL,
  `review_state` text DEFAULT 'needs_review' NOT NULL CHECK (`review_state` IN ('needs_review', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_company_outreach_contacts_provenance` ON `company_outreach_contacts` (`target_id`, `email`, `source_url`);
--> statement-breakpoint
CREATE TRIGGER `company_outreach_contact_provenance_immutable`
BEFORE UPDATE OF `target_id`, `email`, `source_url`, `excerpt`, `source_type`, `extracted_at`, `suitability`, `suitability_reason` ON `company_outreach_contacts`
BEGIN SELECT RAISE(ABORT, 'company outreach contact provenance is immutable'); END;
--> statement-breakpoint
CREATE TABLE `company_outreach_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `target_id` text NOT NULL REFERENCES `company_outreach_targets`(`id`),
  `state` text DEFAULT 'draft' NOT NULL CHECK (`state` IN ('draft', 'approved', 'rejected')),
  `approved_revision_id` text,
  `approved_at` text,
  `rejected_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_outreach_draft_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `draft_id` text NOT NULL REFERENCES `company_outreach_drafts`(`id`),
  `target_id` text NOT NULL REFERENCES `company_outreach_targets`(`id`),
  `version` integer NOT NULL,
  `template_version` integer DEFAULT 1 NOT NULL,
  `contact_id` text NOT NULL REFERENCES `company_outreach_contacts`(`id`),
  `claim_ids` text NOT NULL,
  `body` text NOT NULL,
  `body_hash` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_company_outreach_revisions_draft_version` ON `company_outreach_draft_revisions` (`draft_id`, `version`);
--> statement-breakpoint
CREATE TRIGGER `company_outreach_revisions_immutable_update`
BEFORE UPDATE ON `company_outreach_draft_revisions`
BEGIN SELECT RAISE(ABORT, 'company outreach revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `company_outreach_revisions_immutable_delete`
BEFORE DELETE ON `company_outreach_draft_revisions`
BEGIN SELECT RAISE(ABORT, 'company outreach revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `company_outreach_revisions_require_current_accepted_evidence`
BEFORE INSERT ON `company_outreach_draft_revisions`
WHEN
  NOT json_valid(NEW.`claim_ids`)
  OR json_array_length(NEW.`claim_ids`) = 0
  OR NOT EXISTS (
    SELECT 1
    FROM `company_outreach_drafts` d
    JOIN `company_outreach_targets` t ON t.`id` = d.`target_id`
    JOIN `company_outreach_contacts` c ON c.`id` = NEW.`contact_id`
    WHERE d.`id` = NEW.`draft_id`
      AND d.`state` = 'draft'
      AND d.`target_id` = NEW.`target_id`
      AND t.`id` = NEW.`target_id`
      AND t.`state` = 'active'
      AND c.`target_id` = NEW.`target_id`
      AND c.`review_state` = 'accepted'
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.`claim_ids`) pins
    LEFT JOIN `candidate_claims` claim ON claim.`id` = pins.`value`
    WHERE claim.`id` IS NULL OR claim.`status` <> 'approved'
  )
BEGIN SELECT RAISE(ABORT, 'company outreach revision pins stale or unaccepted evidence'); END;
--> statement-breakpoint
CREATE TRIGGER `company_outreach_drafts_approval_revalidate`
BEFORE UPDATE OF `state`, `approved_revision_id` ON `company_outreach_drafts`
WHEN NEW.`state` = 'approved'
BEGIN
  SELECT CASE WHEN OLD.`state` <> 'draft' THEN RAISE(ABORT, 'only drafts can be approved') END;
  SELECT CASE WHEN NEW.`approved_revision_id` IS NULL THEN RAISE(ABORT, 'approved revision is required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `company_outreach_draft_revisions` r
    JOIN `company_outreach_targets` t ON t.`id` = NEW.`target_id`
    JOIN `company_outreach_contacts` c ON c.`id` = r.`contact_id`
    WHERE r.`id` = NEW.`approved_revision_id`
      AND r.`draft_id` = NEW.`id`
      AND r.`target_id` = NEW.`target_id`
      AND r.`version` = (SELECT MAX(latest.`version`) FROM `company_outreach_draft_revisions` latest WHERE latest.`draft_id` = NEW.`id`)
      AND t.`state` = 'active'
      AND c.`target_id` = NEW.`target_id`
      AND c.`review_state` = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(r.`claim_ids`) pins
        LEFT JOIN `candidate_claims` claim ON claim.`id` = pins.`value`
        WHERE claim.`id` IS NULL OR claim.`status` <> 'approved'
      )
  ) THEN RAISE(ABORT, 'company outreach draft approval bindings are stale') END;
END;
--> statement-breakpoint
CREATE TRIGGER `company_outreach_drafts_approved_immutable`
BEFORE UPDATE ON `company_outreach_drafts`
WHEN OLD.`state` = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved company outreach drafts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `company_outreach_contact_approved_pin_immutable_update`
BEFORE UPDATE ON `company_outreach_contacts`
WHEN EXISTS (
  SELECT 1 FROM `company_outreach_drafts` d
  JOIN `company_outreach_draft_revisions` r ON r.`id` = d.`approved_revision_id`
  WHERE d.`state` = 'approved' AND r.`contact_id` = OLD.`id`
)
BEGIN SELECT RAISE(ABORT, 'approved company outreach contact evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `company_outreach_contact_approved_pin_immutable_delete`
BEFORE DELETE ON `company_outreach_contacts`
WHEN EXISTS (
  SELECT 1 FROM `company_outreach_drafts` d
  JOIN `company_outreach_draft_revisions` r ON r.`id` = d.`approved_revision_id`
  WHERE d.`state` = 'approved' AND r.`contact_id` = OLD.`id`
)
BEGIN SELECT RAISE(ABORT, 'approved company outreach contact evidence is immutable'); END;
