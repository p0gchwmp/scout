ALTER TABLE `company_outreach_targets` ADD COLUMN `origin` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `company_outreach_targets` ADD COLUMN `research_focus` text;
--> statement-breakpoint
ALTER TABLE `company_outreach_targets` ADD COLUMN `priority_score` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `company_outreach_contacts` ADD COLUMN `source_context` text;
