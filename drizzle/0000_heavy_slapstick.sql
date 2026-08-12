CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`status` text DEFAULT 'shortlisted' NOT NULL,
	`approved_at` text,
	`submitted_at` text,
	`blockers` text DEFAULT '[]' NOT NULL,
	`submitted_fields` text DEFAULT '{}' NOT NULL,
	`confirmation_url` text,
	`artifact_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_applications_job` ON `applications` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
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
	`state` text DEFAULT 'discovered' NOT NULL,
	`fingerprint` text NOT NULL,
	`posted_at` text,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_source_external` ON `jobs` (`source`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_canonical_url` ON `jobs` (`canonical_url`);--> statement-breakpoint
CREATE TABLE `profile_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`claim` text NOT NULL,
	`evidence` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
