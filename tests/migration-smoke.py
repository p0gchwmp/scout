import pathlib
import sqlite3


def expect_integrity_error(operation, message):
    try:
        operation()
    except sqlite3.IntegrityError:
        return
    raise AssertionError(message)


root = pathlib.Path(__file__).resolve().parent.parent / "drizzle"
connection = sqlite3.connect(":memory:")
connection.execute("PRAGMA foreign_keys=ON")
connection.executescript((root / "0000_heavy_slapstick.sql").read_text(encoding="utf-8").replace("--> statement-breakpoint", ""))
connection.execute("""
INSERT INTO jobs (
  id, source, external_id, canonical_url, company, title, description, location,
  workplace_type, score, score_explanation, eligibility_risks, state, fingerprint, last_seen_at
) VALUES (
  'legacy-job', 'greenhouse', 'legacy-1', 'https://job-boards.greenhouse.io/example/jobs/1',
  'Example', 'Legacy role', '', '', 'unspecified', 0, '[]', '[]', 'discovered', 'legacy', '2026-08-01T00:00:00Z'
)
""")
connection.execute("INSERT INTO applications(id, job_id) VALUES ('legacy-application', 'legacy-job')")
connection.commit()
migration = (root / "0001_scout_vertical.sql").read_text(encoding="utf-8").replace("--> statement-breakpoint", "")
# D1 applies a migration as a transaction. Wrapping the SQLite smoke the same way
# ensures defer_foreign_keys is exercised instead of silently relying on FK disablement.
connection.executescript(f"BEGIN;\n{migration}\nCOMMIT;")

assert connection.execute("SELECT first_seen_at FROM jobs WHERE id = 'legacy-job'").fetchone() == ("2026-08-01T00:00:00Z",)
assert connection.execute("SELECT job_id FROM applications WHERE id = 'legacy-application'").fetchone() == ("legacy-job",)

connection.execute("INSERT INTO company_sources(id, provider, company_name, board_token, company_domain) VALUES ('source-a', 'greenhouse', 'A', 'board-a', 'a.example')")
connection.execute("INSERT INTO company_sources(id, provider, company_name, board_token, company_domain) VALUES ('source-b', 'greenhouse', 'B', 'board-b', 'b.example')")
connection.execute("INSERT INTO sync_runs(id, source_id, idempotency_key, status, observed_at) VALUES ('run-a', 'source-a', 'run-a', 'completed', '2026-08-15T00:00:00Z')")
connection.execute("INSERT INTO sync_runs(id, source_id, idempotency_key, status, observed_at) VALUES ('running-b', 'source-b', 'running-b', 'running', '2026-08-15T00:00:00Z')")
expect_integrity_error(
    lambda: connection.execute("INSERT INTO sync_runs(id, source_id, idempotency_key, status, observed_at) VALUES ('overlap-b', 'source-b', 'overlap-b', 'running', '2026-08-15T00:01:00Z')"),
    "overlapping source runs were not rejected",
)
connection.execute("UPDATE sync_runs SET status = 'failed' WHERE id = 'running-b'")

job_values = """
INSERT INTO jobs (
  id, source, source_registry_id, external_id, canonical_url, company, title, fingerprint
) VALUES (?, 'greenhouse', ?, '123', ?, ?, 'Role', ?)
"""
connection.execute(job_values, ("job-a", "source-a", "https://job-boards.greenhouse.io/board-a/jobs/123", "A", "source-a|123"))
connection.execute(job_values, ("job-b", "source-b", "https://job-boards.greenhouse.io/board-b/jobs/123", "B", "source-b|123"))
assert connection.execute("SELECT COUNT(*) FROM jobs WHERE external_id = '123'").fetchone() == (2,)

connection.execute("""
INSERT INTO job_snapshots (
  id, job_id, sync_run_id, version, content_hash, canonical_url, company, title,
  description, location, workplace_type, score, score_explanation, eligibility_risks, captured_at
) VALUES (
  'snapshot-a', 'job-a', 'run-a', 1, 'hash-a',
  'https://job-boards.greenhouse.io/board-a/jobs/123', 'A', 'Role',
  'Email recruiting@a.example', 'Remote', 'remote', 90, '[]', '[]', '2026-08-15T00:00:00Z'
)
""")
connection.execute("UPDATE jobs SET current_snapshot_id = 'snapshot-a' WHERE id = 'job-a'")
expect_integrity_error(
    lambda: connection.execute("UPDATE job_snapshots SET title = 'mutated' WHERE id = 'snapshot-a'"),
    "job snapshot mutation was not blocked",
)
expect_integrity_error(
    lambda: connection.execute("DELETE FROM job_snapshots WHERE id = 'snapshot-a'"),
    "job snapshot deletion was not blocked",
)
expect_integrity_error(
    lambda: connection.execute("""
        INSERT INTO contact_evidence (
          id, job_id, job_snapshot_id, email, source_url, excerpt, extracted_at, suitability, suitability_reason
        ) VALUES (
          'contact-mismatch', 'job-b', 'snapshot-a', 'recruiting@b.example',
          'https://job-boards.greenhouse.io/board-b/jobs/123', 'recruiting@b.example',
          '2026-08-15T00:00:00Z', 'high', 'published'
        )
    """),
    "contact evidence accepted a snapshot belonging to another job",
)
connection.execute("""
INSERT INTO contact_evidence (
  id, job_id, job_snapshot_id, email, source_url, excerpt, extracted_at, suitability, suitability_reason
) VALUES (
  'contact-a', 'job-a', 'snapshot-a', 'recruiting@a.example',
  'https://job-boards.greenhouse.io/board-a/jobs/123', 'Email recruiting@a.example',
  '2026-08-15T00:00:00Z', 'high', 'Published first-party recruiting address'
)
""")

connection.execute("INSERT INTO candidate_claims(id, statement, evidence, status) VALUES ('claim', 'statement', 'evidence', 'draft')")
assert connection.execute("SELECT version FROM candidate_claims WHERE id = 'claim'").fetchone() == (1,)
connection.execute("UPDATE candidate_claims SET statement = 'reviewed statement', version = version + 1 WHERE id = 'claim' AND status = 'draft' AND version = 1")
assert connection.execute("SELECT statement, version FROM candidate_claims WHERE id = 'claim'").fetchone() == ("reviewed statement", 2)
assert connection.execute("UPDATE candidate_claims SET status = 'approved', version = version + 1 WHERE id = 'claim' AND status = 'draft' AND version = 1").rowcount == 0
connection.execute("UPDATE candidate_claims SET status = 'approved', version = version + 1 WHERE id = 'claim' AND status = 'draft' AND version = 2")
assert connection.execute("SELECT status, version FROM candidate_claims WHERE id = 'claim'").fetchone() == ("approved", 3)
expect_integrity_error(
    lambda: connection.execute("UPDATE candidate_claims SET statement = 'mutated' WHERE id = 'claim'"),
    "approved candidate claim mutation was not blocked",
)

connection.execute("INSERT INTO outreach_drafts(id, job_id) VALUES ('draft', 'job-a')")
revision_sql = """
INSERT INTO outreach_draft_revisions (
  id, draft_id, version, job_snapshot_id, contact_id, claim_ids, body, body_hash
) VALUES (?, 'draft', ?, 'snapshot-a', 'contact-a', '["claim"]', ?, ?)
"""
expect_integrity_error(
    lambda: connection.execute(revision_sql, ("revision-1", 1, "body-1", "body-hash-1")),
    "draft revision accepted unreviewed contact evidence",
)
connection.execute("UPDATE contact_evidence SET review_state = 'accepted' WHERE id = 'contact-a'")
connection.execute(revision_sql, ("revision-1", 1, "body-1", "body-hash-1"))
connection.execute(revision_sql, ("revision-2", 2, "body-2", "body-hash-2"))

expect_integrity_error(
    lambda: connection.execute("UPDATE outreach_drafts SET state = 'approved', approved_revision_id = 'revision-1' WHERE id = 'draft'"),
    "approval accepted a stale, non-latest revision",
)
connection.execute("UPDATE jobs SET current_snapshot_id = NULL WHERE id = 'job-a'")
expect_integrity_error(
    lambda: connection.execute("UPDATE outreach_drafts SET state = 'approved', approved_revision_id = 'revision-2' WHERE id = 'draft'"),
    "approval accepted a stale job snapshot",
)
connection.execute("UPDATE jobs SET current_snapshot_id = 'snapshot-a' WHERE id = 'job-a'")
connection.execute("UPDATE outreach_drafts SET state = 'approved', approved_revision_id = 'revision-2' WHERE id = 'draft'")
assert connection.execute("SELECT approved_revision_id FROM outreach_drafts WHERE id = 'draft'").fetchone() == ("revision-2",)
expect_integrity_error(
    lambda: connection.execute("UPDATE contact_evidence SET review_state = 'rejected' WHERE id = 'contact-a'"),
    "approved contact evidence was mutable",
)
expect_integrity_error(
    lambda: connection.execute("UPDATE outreach_drafts SET state = 'draft' WHERE id = 'draft'"),
    "approved draft was mutable",
)

# Exact evidence provenance itself is immutable even before approval.
connection.execute("INSERT INTO contact_evidence(id, job_id, job_snapshot_id, email, source_url, excerpt, extracted_at, suitability, suitability_reason) VALUES ('contact-b', 'job-a', 'snapshot-a', 'talent@a.example', 'https://job-boards.greenhouse.io/board-a/jobs/123', 'talent@a.example', '2026-08-15T00:00:00Z', 'high', 'published')")
expect_integrity_error(
    lambda: connection.execute("UPDATE contact_evidence SET source_url = 'https://example.invalid' WHERE id = 'contact-b'"),
    "contact provenance mutation was not blocked",
)

tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
required = {"company_sources", "sync_runs", "jobs", "job_snapshots", "contact_evidence", "candidate_claims", "outreach_drafts", "outreach_draft_revisions"}
assert required <= tables, required - tables
indexes = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
assert "idx_jobs_source_external" not in indexes
expected_indexes = {
    "idx_company_sources_provider_token",
    "idx_sync_runs_source_key",
    "idx_sync_runs_one_running_source",
    "idx_jobs_canonical_url",
    "idx_jobs_registry_external",
    "idx_jobs_lifecycle_score",
    "idx_job_snapshots_job_version",
    "idx_job_snapshots_job_hash",
    "idx_contact_evidence_provenance",
    "idx_outreach_revisions_draft_version",
}
assert expected_indexes <= indexes, expected_indexes - indexes
foreign_key_errors = list(connection.execute("PRAGMA foreign_key_check"))
assert not foreign_key_errors, foreign_key_errors
print(f"migration smoke passed ({len(tables)} tables; legacy rows preserved; composite identity, overlap, claim CAS, review, revision approval, snapshot/provenance immutability, and foreign keys verified)")
