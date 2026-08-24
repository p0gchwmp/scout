ALTER TABLE `contact_evidence` ADD `source_type` text DEFAULT 'official_job_posting' NOT NULL;
--> statement-breakpoint
DROP TRIGGER `contact_evidence_provenance_immutable`;
--> statement-breakpoint
CREATE TRIGGER `contact_evidence_provenance_immutable`
BEFORE UPDATE OF `job_id`, `job_snapshot_id`, `email`, `source_url`, `excerpt`, `source_type`, `extracted_at` ON `contact_evidence`
BEGIN SELECT RAISE(ABORT, 'contact evidence provenance is immutable'); END;
