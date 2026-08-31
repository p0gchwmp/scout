# M22 — Operational UX Refinement

## Goal

Make Scout's daily review path easier to understand without changing any trust, storage, discovery, application, contact, or execution contract.

## Scope

M22 is intentionally a UI-language and navigation refinement only:

- Shortlist decisions become **Accept / Watch / Reject** while preserving the exact existing stored states:
  - Accept -> `shortlisted`
  - Watch -> `saved`
  - Reject -> `rejected`
- The Shortlist evidence blocks are renamed to make their meaning explicit:
  - **Why Scout surfaced this**
  - **Exact approved claim support**
  - **Qualification / evidence checks**
- Inbox explicitly distinguishes ephemeral/unresolved discovery leads from evidence-backed fit review and points the owner to Shortlist after official resolution.
- Applications/Today gets a direct **Review role evidence** link to the existing owner-only role cockpit.

## Safety boundary

M22 does not add or alter:

- application submission;
- email sending;
- automatic contact acceptance;
- contact scraping or guessing;
- AI/provider calls;
- discovery sources;
- database schema or migrations;
- job-state values;
- claim-selection logic;
- readiness logic;
- immutable snapshot/evidence contracts.

`Accept` is deliberately only a local Scout review decision. It does not approve or submit an application and does not contact an employer.

## Verification target

Before repository commit, run the complete Scout release gate from a current checkout:

```bash
npm run verify:release
```

The focused M22 policy test should also prove that the human-facing decision vocabulary maps to the existing states and that no send/submit route is introduced.
