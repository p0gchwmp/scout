# M20 — Safe Local End-to-End Release Rehearsal

## Goal
Convert Scout's release smoke checklist into a deterministic CI-visible rehearsal of the production-built Worker without contacting external providers or adding a second database/runtime system.

## Rehearsal coverage
- anonymous API access is denied;
- non-owner API access is denied;
- owner health returns healthy with application submission and email sending disabled;
- runtime readiness verifies the required Scout tables and immutability triggers against a deterministic D1 test double;
- `/setup` renders the Runtime Preflight surface without exposing `SCOUT_*` configuration names;
- representative claims and application mutations reject cross-origin requests;
- no application-submit endpoint exists;
- no Gmail-send endpoint exists;
- external network fetches are forbidden during the rehearsal.

## Commands
The rehearsal is part of `npm test` after the production build. It can also be run explicitly with:

```bash
npm run scout:release:rehearsal
```

## Safety boundary
M20 does not deploy Scout, run live discovery, call AI/search providers, refresh Gmail OAuth, create Gmail drafts, send email, contact recruiters, submit applications, solve CAPTCHA, seed/reset production data, or enable paid services.
