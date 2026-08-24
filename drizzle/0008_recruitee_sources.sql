PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `__new_company_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL CHECK (`provider` IN ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday', 'bamboohr', 'recruitee')),
  `company_name` text NOT NULL,
  `board_token` text NOT NULL,
  `company_domain` text NOT NULL,
  `careers_url` text,
  `enabled` integer DEFAULT true NOT NULL CHECK (`enabled` IN (0, 1)),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_company_sources` (`id`, `provider`, `company_name`, `board_token`, `company_domain`, `careers_url`, `enabled`, `created_at`)
SELECT `id`, `provider`, `company_name`, `board_token`, `company_domain`, `careers_url`, `enabled`, `created_at` FROM `company_sources`;
--> statement-breakpoint
DROP TABLE `company_sources`;
--> statement-breakpoint
ALTER TABLE `__new_company_sources` RENAME TO `company_sources`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_company_sources_provider_token` ON `company_sources` (`provider`, `board_token`);
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
