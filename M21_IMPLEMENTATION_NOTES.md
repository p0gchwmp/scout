# M21 — Complete Safe Demo Workflow

## Goal

Extend Scout's existing local-only demo path beyond jobs and approved claims so the owner can rehearse the later review stages without contacting a real company, sending email, submitting an application, or introducing a second demo database.

## Added workflow fixture

`scout-demo-workflow.mjs` first invokes the existing `seedLocalDemo()` path against the same local Wrangler D1 SQLite database, then adds deterministic synthetic rows for:

- six verified local-demo profile fields required to prepare a review packet;
- two public-contact evidence examples on reserved `.example` domains — one accepted and one intentionally left `needs_review`;
- one outreach draft and immutable revision pinned to the accepted contact, current immutable job snapshot, and approved demo claim IDs;
- one application review packet with `submitted_at = NULL`, no confirmation URL, and `externalSideEffect: false`.

## Safety boundary

- Local D1 only; the existing production/CI fail-closed guard is reused.
- No `fetch`, child process, Wrangler remote mode, Cloudflare runtime binding, provider call, Gmail call, email send, application submit, CAPTCHA handling, or private-contact discovery path.
- All contact addresses and contact-source URLs use IANA-reserved `.example` domains.
- The outreach record remains a draft and has no approved revision.
- The application record is `ready_for_review`; it is not approved or submitted.
- Reset still uses the existing explicit `--confirm-local-reset` guard and existing trigger-preservation logic.

## Commands

```bash
npm run scout:demo:workflow:status
npm run scout:demo:workflow:seed
npm run scout:demo:workflow:reset -- --confirm-local-reset
```

Existing `scout:demo:*` commands remain unchanged.
