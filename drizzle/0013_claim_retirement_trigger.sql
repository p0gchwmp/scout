DROP TRIGGER `candidate_claims_approved_immutable_update`;
--> statement-breakpoint
CREATE TRIGGER `candidate_claims_approved_immutable_update`
BEFORE UPDATE ON `candidate_claims`
WHEN OLD.`status` = 'approved'
  AND NOT (
    OLD.`approved_at` IS NOT NULL
    AND NEW.`id` IS OLD.`id`
    AND NEW.`statement` IS OLD.`statement`
    AND NEW.`evidence` IS OLD.`evidence`
    AND NEW.`status` = 'rejected'
    AND NEW.`version` = OLD.`version` + 1
    AND NEW.`approved_at` IS OLD.`approved_at`
    AND NEW.`created_at` IS OLD.`created_at`
  )
BEGIN SELECT RAISE(ABORT, 'approved candidate claims are immutable'); END;
