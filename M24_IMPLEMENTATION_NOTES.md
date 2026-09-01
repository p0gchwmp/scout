# M24 — Safe Local Demo Reset Hardening

## Why this milestone is incremental

Scout already has deterministic local demo fixtures and production/CI fail-closed checks. M24 hardens the destructive edge of that workflow rather than creating a second demo system.

The current standard reset path can delete every row from the local Scout D1 database after one confirmation. That is acceptable for a disposable DB, but too easy to misuse once the owner has mixed real local evidence with demo fixtures.

## M24 design

### 1. Safe reset becomes the default

`scout:demo:reset` and `scout:demo:workflow:reset` call `scripts/scout-demo-reset.mjs`.

The safe reset:

- requires `--confirm-demo-reset`;
- resolves only the repo-local Wrangler D1 SQLite file;
- reuses Scout's existing production/CI fail-closed environment guard;
- deletes only IDs in the reserved literal `demo_*` namespace;
- uses SQLite `GLOB 'demo_*'`, not `LIKE 'demo_%'`, so `_` cannot act as a wildcard;
- verifies non-demo row counts are unchanged;
- runs under `BEGIN IMMEDIATE` and rolls back on any error;
- runs `PRAGMA foreign_key_check` before commit;
- suspends only the three immutable DELETE blockers required for cleanup;
- restores those exact trigger definitions and confirms they exist afterward;
- leaves all other triggers active and untouched.

### 2. Full local wipe remains available, but is intentionally explicit

No recovery capability is removed. A separate `scout:demo:reset:all` command calls `scripts/scout-demo-reset-all.mjs` and requires both:

- `--confirm-local-reset`
- `--allow-all-local-data`

It remains local-D1-only and inherits the same production/CI fail-closed guard.

### 3. No external side effects

The reset code contains no fetch, provider call, child process, Wrangler remote flag, Gmail path, recruiter contact, or application submission path.

## Package script changes

```json
"scout:demo:reset": "node scripts/scout-demo-reset.mjs",
"scout:demo:reset:all": "node scripts/scout-demo-reset-all.mjs",
"scout:demo:workflow:reset": "node scripts/scout-demo-reset.mjs"
```

Example safe reset:

```bash
npm run scout:demo:reset -- --confirm-demo-reset
```

Full local wipe, only when intentionally required:

```bash
npm run scout:demo:reset:all -- --confirm-local-reset --allow-all-local-data
```

## Intentionally unchanged

- production database and remote D1 operations;
- seed fixture contents;
- job snapshot immutability rules;
- claim approval rules;
- contact provenance rules;
- outreach pinning;
- application no-submit boundary;
- email no-send boundary.
