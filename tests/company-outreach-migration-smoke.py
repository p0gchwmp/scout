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
connection.execute("""
CREATE TABLE candidate_claims (
  id text PRIMARY KEY NOT NULL,
  statement text NOT NULL,
  evidence text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','approved','rejected'))
)
""")
migrations = []
for name in ["0011_company_outreach_targets.sql", "0012_company_outreach_autopilot.sql"]:
    migrations.append((root / name).read_text(encoding="utf-8").replace("--> statement-breakpoint", ""))
connection.executescript(f"BEGIN;\n{' '.join(migrations)}\nCOMMIT;")

columns = {row[1] for row in connection.execute("PRAGMA table_info(company_outreach_targets)")}
assert {"origin", "research_focus", "priority_score"}.issubset(columns)
contact_columns = {row[1] for row in connection.execute("PRAGMA table_info(company_outreach_contacts)")}
assert "source_context" in contact_columns

connection.execute("INSERT INTO candidate_claims(id, statement, evidence, status) VALUES ('claim-ok','Approved claim','evidence','approved')")
connection.execute("INSERT INTO candidate_claims(id, statement, evidence, status) VALUES ('claim-draft','Draft claim','evidence','draft')")
connection.execute("""
INSERT INTO company_outreach_targets(id, company_name, company_domain, official_url, track, origin, research_focus, priority_score)
VALUES ('target-a','Example Co','example.com','https://example.com/','now_remote','controlled_source','product operations',80)
""")
expect_integrity_error(
    lambda: connection.execute("UPDATE company_outreach_targets SET company_domain='evil.example' WHERE id='target-a'"),
    "company outreach target identity was mutable",
)
connection.execute("""
INSERT INTO company_outreach_contacts(
  id,target_id,email,source_url,excerpt,source_type,source_context,extracted_at,suitability,suitability_reason
) VALUES (
  'contact-a','target-a','careers@example.com','https://example.com/careers',
  'Internship enquiries: careers@example.com','official_careers','first_party','2026-08-28T00:00:00Z','review','published'
)
""")
connection.execute("INSERT INTO company_outreach_drafts(id,target_id) VALUES ('draft-a','target-a')")
revision = """
INSERT INTO company_outreach_draft_revisions(
  id,draft_id,target_id,version,contact_id,claim_ids,body,body_hash
) VALUES (?,?,?,?,?,?,?,?)
"""
expect_integrity_error(
    lambda: connection.execute(revision, ('revision-unaccepted','draft-a','target-a',1,'contact-a','["claim-ok"]','body','hash-a')),
    "company outreach revision accepted unreviewed contact evidence",
)
connection.execute("UPDATE company_outreach_contacts SET review_state='accepted' WHERE id='contact-a'")
expect_integrity_error(
    lambda: connection.execute(revision, ('revision-draft-claim','draft-a','target-a',1,'contact-a','["claim-draft"]','body','hash-b')),
    "company outreach revision accepted a draft claim",
)
connection.execute(revision, ('revision-1','draft-a','target-a',1,'contact-a','["claim-ok"]','body-1','hash-1'))
connection.execute(revision, ('revision-2','draft-a','target-a',2,'contact-a','["claim-ok"]','body-2','hash-2'))
expect_integrity_error(
    lambda: connection.execute("UPDATE company_outreach_drafts SET state='approved', approved_revision_id='revision-1' WHERE id='draft-a'"),
    "company outreach approval accepted a stale revision",
)
connection.execute("UPDATE company_outreach_drafts SET state='approved', approved_revision_id='revision-2' WHERE id='draft-a'")
expect_integrity_error(
    lambda: connection.execute("UPDATE company_outreach_contacts SET review_state='rejected' WHERE id='contact-a'"),
    "approved company outreach contact evidence was mutable",
)
expect_integrity_error(
    lambda: connection.execute("UPDATE company_outreach_drafts SET state='draft' WHERE id='draft-a'"),
    "approved company outreach draft was mutable",
)
assert connection.execute("SELECT approved_revision_id FROM company_outreach_drafts WHERE id='draft-a'").fetchone() == ('revision-2',)
print("company outreach migration smoke: green")
