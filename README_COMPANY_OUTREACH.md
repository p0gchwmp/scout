# Scout company-first outreach

Company-first outreach exists for legitimate internship/project outreach when there is no advertised internship.

## Evidence model

A `company_outreach_target` is not a job. It records an owner-approved company name, official public domain/URL, outreach track, and optional owner-written interest sentence. The identity is immutable after creation.

Contact research receives only the stored target ID. The server derives the company domain and starting URL from that target, then uses the same bounded first-party public-page research logic used elsewhere in Scout. Browser callers cannot supply a fetch target to the research endpoint.

Captured contacts preserve email, exact source URL, excerpt, source type, and extraction timestamp. They default to `needs_review`. No email-pattern guessing, hidden LinkedIn extraction, broker enrichment, or automatic acceptance is available.

## Draft model

A speculative draft requires:

- an active company-first target;
- accepted published contact evidence bound to that target;
- 1–3 explicitly selected usable approved claim IDs;
- verified owner name evidence.

The deterministic template explicitly says the outreach is speculative and does not claim that a formal opening exists. If a configured cloud AI route is available, Scout may refine the writing, but the result is rejected back to the deterministic template if it implies an advertised opening.

Draft revisions are immutable. Approval binds the latest revision, accepted contact, active target, and approved claims. Only an approved exact revision can be handed to Gmail draft creation.

## Gmail boundary

Company-first outreach uses Gmail `drafts.create` through the existing signed Scout agent path. No send operation is added. Final Send remains manual in Gmail.

## Local database

After pulling the migration locally, run:

```powershell
npm run scout:company-outreach:migrate:local
```

The script finds exactly one repo-local Wrangler D1 database, creates a SQLite backup, applies only migration `0011_company_outreach_targets.sql` when the table is absent, and checks integrity/foreign keys. It has no remote database path.
