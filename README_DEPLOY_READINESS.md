# Scout deployment readiness

Scout is owner-only and fail-closed. This checklist prepares a release; it does not authorize a deployment, application submission, recruiter contact, email send, paid service, or automation.

## 1. Required release gate

From a clean checkout of `feat/discovery-contact-mvp`:

```bash
npm ci
npm run verify:release
```

`verify:release` runs the repository test/build gate, ESLint, the migration smoke test, Drizzle generation, a clean-diff check after generation, a second production build, `git diff --check`, and final Git status/stat output.

Do not release if the command exits non-zero or if Drizzle generation creates uncommitted schema/migration changes.

## 2. Required hosted bindings

`.openai/hosting.json` declares:

- project: `appgprj_6a7c73a113908191b5876c38855be46b`
- D1 binding: `DB`
- R2 binding: `FILES`

The application database code fails closed when `DB` is unavailable.

The hosted runtime must also provide `SCOUT_OWNER_USER_ID`. If it is absent, owner-only pages/APIs return an owner-configuration error rather than opening access.

Do not copy local development auth variables into production. `SCOUT_LOCAL_DEV_RUNTIME`, `SCOUT_LOCAL_DEV_AUTH`, `SCOUT_LOCAL_DEV_USER_ID`, `SCOUT_LOCAL_DISCOVERY_SECRET`, and the local browser handoff secret are development-only surfaces.

## 3. Database migration readiness

The target D1 database must have all committed migrations applied in order through the latest migration in `drizzle/meta/_journal.json` before production traffic uses code that expects that schema.

Current ATS-provider migrations include Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, BambooHR, Recruitee, Teamtailor, and Breezy support.

Run:

```bash
python tests/migration-smoke.py
npm run db:generate
```

A release is blocked if migration smoke fails or generation produces unexpected changes.

Do not blindly restore or downgrade the database during a code rollback. Job snapshots, candidate claims, contact provenance, and outreach revisions are designed to preserve evidence/history. Treat code rollback and database rollback as separate decisions.

## 4. Readiness endpoint

After starting the intended release build, authenticate as the configured owner and open:

```text
/api/health
```

Healthy response:

```json
{
  "status": "ok",
  "database": "ok",
  "ownerOnly": true,
  "externalSideEffects": {
    "applicationSubmission": false,
    "emailSending": false
  }
}
```

A failed readiness check is a release blocker. The endpoint is read-only and owner-gated.

## 5. Manual smoke check

Before release approval, verify as the owner:

1. Dashboard loads without a client runtime error.
2. Claims tab loads and draft/approved/rejected states render correctly.
3. Jobs render resume alignment without missing-field crashes.
4. Internship Inbox can run bounded local/cloud discovery without bursting one ATS provider.
5. A discovered supported role can be upgraded to an immutable official snapshot.
6. Contact evidence remains `needs_review` until explicitly reviewed.
7. Outreach creation produces a draft only; nothing is sent.
8. Application preparation produces a review packet only; nothing is submitted.
9. A non-owner request is denied.
10. Missing `SCOUT_OWNER_USER_ID` fails closed.

## 6. Optional agent configuration

Cloud-agent/search/email-draft integrations are optional deployment surfaces and must stay disabled unless their exact configuration and safety review are intentional. Do not enable paid overage, automatic sending, automatic application submission, private-contact scraping, guessed emails, or uncontrolled discovery sources.

## 7. Release decision

A deploy is ready for explicit owner approval only when all of the following are true:

- `npm run verify:release` passes from a clean current checkout.
- target D1 migrations are confirmed current.
- `/api/health` returns `status: ok` under owner authentication.
- owner-only and same-origin protections remain intact.
- the manual smoke check passes.
- there are no unreviewed deployment-environment secrets/bindings.
- no send/apply/automation capability has been enabled.

Deployment itself requires a separate explicit approval.
