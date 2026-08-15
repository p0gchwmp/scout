# Scout — controlled discovery and outreach drafting MVP

Scout is a small, evidence-first vertical slice for discovering public Greenhouse jobs, preserving what was observed, extracting explicitly published business contact addresses, and preparing human-reviewed outreach drafts. **Scout has no send capability and no application/submission capability.**

## Included in this MVP

- A controlled `company_sources` registry limited to Greenhouse. Sync accepts a registered source ID, never a caller-supplied board token or URL.
- Persisted, idempotent sync runs keyed by `(source_id, idempotency_key)`, with one running sync permitted per source and atomic D1 batch persistence.
- Jobs identified by `(source_registry_id, external_id)`, with immutable content-addressed snapshots. Missing jobs close only after two trustworthy consecutive absences; empty, incomplete, or suspiciously small scans do not mass-close listings.
- Jobs are stored with neutral score `0` and an explicit unranked explanation until a persisted approved profile version is implemented; Scout does not assert candidate skills, preferences, student status, location preferences, or work authorization.
- Exact contact extraction from the already persisted current Greenhouse job content. Contact extraction performs no network fetch and does not crawl a careers page.
- Contact provenance: the board-token-bound Greenhouse evidence URL, surrounding excerpt, extraction timestamp, suitability, and explicit `needs_review`/`accepted`/`rejected` state.
- Candidate claims with explicit draft/approved/rejected state and integer versions. Every mutation supplies `expectedVersion`; the update compares ID, state, and version before incrementing so stale edits or approvals return `409`. Approved claims are immutable in both service logic and SQLite triggers.
- Deterministic, template-versioned outreach revisions pinned to one job snapshot, one contact evidence row, and sorted approved claim IDs.
- Outreach drafts are immutable deterministic revisions. There is no free-form edit action: a draft can only be approved or rejected, and approval names its exact revision while revalidating the current job snapshot, accepted contact, and approved claims.
- D1-backed API routes and a dashboard that loads persisted jobs, sources, and sync-run data; there are no dashboard fixtures.
- The page and every Scout API route require the hosting platform's authenticated ChatGPT user and enforce a fail-closed single owner binding. Browser mutations also require same-origin request metadata.

Legacy application/extension/n8n artifacts remain in the repository for compatibility, but the Scout routes in this slice do not call them, create application records, send outreach, activate workflows, or submit forms.

## Setup

Requires Node.js 22 or newer.

```text
npm ci
npm run test:unit
npm run lint
npm run build
```

Apply `drizzle/0000_heavy_slapstick.sql` and then `drizzle/0001_scout_vertical.sql` to the D1 database bound as `DB`. The hosting control plane may apply these migrations; otherwise use the D1 migration mechanism for your environment. Do not run the second migration twice.

Set the required Cloudflare string binding `SCOUT_OWNER_USER_ID` to the exact authenticated ChatGPT `userId` that owns this deployment. This value is deployment configuration, not a browser-visible setting. If the binding is absent or blank, authenticated requests fail closed with `503` and `{"error":"Scout owner is not configured"}`; authenticated non-owners receive `403`. Do not log the binding or authenticated user IDs. Local rendered-worker tests inject a non-secret test owner ID.

### Register a source

There is deliberately no public source-creation API in this MVP. An operator must validate and insert each source through controlled D1 administration:

```sql
INSERT INTO company_sources (
  id, provider, company_name, board_token, company_domain, careers_url, enabled
) VALUES (
  'src_example',
  'greenhouse',
  'Example Company',
  'example-board-token',
  'example.com',
  NULL,
  1
);
```

Use a stable, non-secret ID, a real Greenhouse board token, and the company's registrable domain. `careers_url` is retained for schema compatibility but is not fetched in this MVP; set it to `NULL`. The database constrains providers to `greenhouse`, while runtime discovery binds evidence to the registered board token and numeric external job ID. Registry administration has no public API or UI, so use D1 access controls.

Run the app with `npm run dev`, open **Sources**, and sync a registered source. The UI uses an hourly idempotency key so a retry in the same hour returns the persisted run.

## API surface

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/sources` | `GET` | List controlled sources and recent persisted runs. Board tokens are omitted. |
| `/api/sync` | `POST` | Sync `{ sourceId, idempotencyKey }`; arbitrary tokens/URLs are not accepted. |
| `/api/jobs` | `GET`, `PATCH` | Read persisted jobs; update local review state only. |
| `/api/contacts` | `GET`, `POST`, `PATCH` | Read evidence, extract from a persisted snapshot for `{ jobId }`, or explicitly accept/reject one evidence record. |
| `/api/claims` | `GET`, `POST`, `PATCH` | Create candidate claims; structurally edit, approve, or reject with `expectedVersion`. |
| `/api/outreach` | `GET`, `POST`, `PATCH` | Deterministically create an immutable draft, or approve/reject its exact `revisionId`. No body edit is accepted. |
| `/api/discover` | `POST` | Returns `410`; arbitrary discovery tokens are disabled. |

There is intentionally no `send`, `apply`, `submit`, scheduler activation, or extension-handoff route.

## Contact extraction policy

Contact extraction does not issue a network request. It examines only the description already captured in the immutable current snapshot from the registered Greenhouse board. The evidence URL is constructed from and validated against that exact board token and numeric external job ID.

Only literal email addresses in persisted posting text are considered: Scout does not guess aliases, de-obfuscate addresses, execute JavaScript, crawl careers pages, or query people-search services. Consumer-mail domains are rejected. Every business address starts as `needs_review`; deterministic mailbox/domain suitability is advisory only. A user must explicitly mark the evidence `accepted` before it can be pinned to a draft.

## Determinism and approval

Generated draft bytes depend only on template version 1 and the pinned candidate name, job snapshot, accepted contact, and sorted approved claims. Every revision stores its SHA-256 body hash and immutable pins. The API accepts no arbitrary body or recipient edit. To change inputs, create a new deterministic draft. Approval requires the exact revision ID and rechecks that the job snapshot remains current, the contact remains accepted, and all pinned claims remain approved.

## Current limitations

- Greenhouse only; no Lever sync in this controlled vertical slice.
- Source administration is direct-to-D1 and relies on operator/database access control. The deployment is deliberately single-owner through `SCOUT_OWNER_USER_ID`; records are not row-scoped for multiple owners.
- Sync writes use an atomic D1 batch and reject overlapping running syncs for the same source. Operational recovery for a genuinely abandoned `running` record still requires operator inspection.
- Contact extraction is intentionally limited to persisted Greenhouse posting content, so it will miss contacts published only on separate careers pages, JavaScript-rendered pages, images, or obfuscated text. The consumer-domain denylist is finite.
- Suitability is deterministic mailbox/domain triage, not proof that the recipient welcomes outreach.
- No per-user tenancy, rate limiting, background scheduler, retries/backoff, LLM generation, sending, application filling, or browser automation is included.
- Existing rows from the legacy schema are preserved but have no Scout snapshot until observed through a registered-source sync.

## Verification

- `npm run test:unit` covers fail-closed owner authorization, same-origin mutation checks, adversarial JSON validation, idempotency, overlapping-sync rejection, review-state preservation, conservative repeated-missing reconciliation, A→B→A snapshot reuse, explicitly unranked ingestion, board-token evidence binding, persisted-content-only extraction, immutable/versioned claims, deterministic immutable outreach, migration constraints, and absence of send/apply API paths.
- `python tests/migration-smoke.py` applies both migrations to SQLite, verifies legacy rows survive, exercises claim-version CAS, approved-claim immutability, immutable snapshots, contact/snapshot job matching, approval revalidation, and foreign keys.
- `npm run lint` checks source files (generated `work`, `dist`, and `outputs` artifacts are ignored).
- `npm run build` creates the production vinext/Cloudflare build.
- `npm test` runs unit tests, the production build, and the rendered HTML smoke test.
