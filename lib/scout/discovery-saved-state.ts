import { env } from "cloudflare:workers";

export const DISCOVERY_SAVED_STATE_BACKFILL_ID = "2026-09-12-discovery-saved-state-v1";

let backfillPromise: Promise<void> | null = null;

async function applyDiscoverySavedStateBackfill() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable for saved-state governance");

  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS scout_runtime_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [resetResult] = await env.DB.batch([
    env.DB.prepare(`
      UPDATE jobs
      SET state = 'shortlisted'
      WHERE state = 'saved'
        AND NOT EXISTS (
          SELECT 1 FROM scout_runtime_migrations
          WHERE id = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM contact_evidence
          WHERE contact_evidence.job_id = jobs.id
            AND contact_evidence.review_state = 'accepted'
        )
        AND NOT EXISTS (
          SELECT 1 FROM outreach_drafts
          WHERE outreach_drafts.job_id = jobs.id
        )
    `).bind(DISCOVERY_SAVED_STATE_BACKFILL_ID),
    env.DB.prepare(`
      INSERT OR IGNORE INTO scout_runtime_migrations (id, applied_at)
      VALUES (?, CURRENT_TIMESTAMP)
    `).bind(DISCOVERY_SAVED_STATE_BACKFILL_ID),
  ]);

  const changes = Number(resetResult?.meta?.changes ?? 0);
  if (changes > 0) console.info("Scout normalized legacy auto-saved jobs", { changes });
}

export function ensureDiscoverySavedStateBackfill() {
  backfillPromise ??= applyDiscoverySavedStateBackfill().catch((error) => {
    backfillPromise = null;
    throw error;
  });
  return backfillPromise;
}
