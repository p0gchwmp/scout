import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parent.parent / "drizzle"
connection = sqlite3.connect(":memory:")
connection.execute("PRAGMA foreign_keys=ON")

for name in [
    "0000_heavy_slapstick.sql", "0001_scout_vertical.sql", "0002_lever_sources.sql",
    "0003_contact_source_type.sql", "0004_expand_ats_providers.sql", "0005_smartrecruiters_sources.sql",
    "0006_workday_sources.sql", "0007_bamboohr_sources.sql", "0008_recruitee_sources.sql",
    "0009_teamtailor_sources.sql", "0010_breezy_sources.sql", "0011_personio_sources.sql",
]:
    sql = (root / name).read_text(encoding="utf-8").replace("--> statement-breakpoint", "")
    connection.executescript(f"BEGIN;\n{sql}\nCOMMIT;")

connection.execute("INSERT INTO company_sources(id, provider, company_name, board_token, company_domain) VALUES ('personio-source', 'personio', 'Acme', 'acme', 'acme.example')")
assert connection.execute("SELECT provider, board_token FROM company_sources WHERE id = 'personio-source'").fetchone() == ("personio", "acme")
try:
    connection.execute("INSERT INTO company_sources(id, provider, company_name, board_token, company_domain) VALUES ('unsupported', 'icims', 'Bad', 'bad', 'bad.example')")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("unsupported provider bypassed the post-Personio company_sources constraint")
print("personio migration smoke: eleven ATS providers constrained")
