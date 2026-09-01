# M23 — Claim Governance & Evidence Traceability Hardening

## Why this milestone is incremental

Current `main` already contains the core claim-governance backend and Dashboard tab:

- claim statuses: `draft`, `approved`, `rejected`;
- optimistic concurrency through `expectedVersion`;
- draft-only edit/approve/reject transitions;
- immutable approved/rejected claims;
- approved-only downstream selection;
- exact supporting claim IDs in resume alignment.

M23 therefore hardens the operator experience instead of rebuilding the data model.

## Added

### `/claims` owner-only workspace

- Uses the existing owner-page auth boundary.
- Shows exact claim ID, statement, evidence, status, version, created/updated/approved timestamps.
- Filters by all/draft/approved/rejected.
- Creates new claims as drafts only.
- Uses `PATCH /api/claims` for edit/approve/reject.
- Pins every mutation to `expectedVersion`.
- Reloads latest state on HTTP 409 conflicts.
- Disables approval/rejection while local edits are unsaved.
- Keeps approved/rejected claims read-only.
- Explicitly states that claim review has no send/apply/contact side effect.

### M23 regression test

`tests/m23-claims-governance.test.ts` checks:

1. `/claims` is owner-only.
2. Exact claim identity/version/evidence/status are visible.
3. Mutations are expected-version pinned and use the existing CAS route.
4. Unsaved edits cannot be approved/rejected.
5. Approved/rejected claims stay immutable/excluded.
6. No send/submit route is introduced.

## Intentionally unchanged

- Database schema and migrations.
- `/api/claims` state machine.
- owner authentication and same-origin mutation policy.
- immutable job snapshots.
- outreach revision pinning.
- contact provenance policy.
- no-send / no-submit boundaries.

## Offline validation

Against the uploaded repository snapshot with the M23 files overlaid:

- M23 targeted contracts: **6/6 passed**.
- Unit suite including M23: **25/25 passed**.
- ESLint on new M23 TS/TSX files: **passed**.
- Full snapshot `tsc --noEmit`: not green due pre-existing unrelated legacy errors in the old uploaded snapshot (claims union narrowing, contacts D1 batch typings, Cloudflare worker globals, and old test typings). This is not reported as a passing M23 release gate.

The authoritative final release verification must run on current `main` after the patch is applied.
