# Scout deployment readiness

Scout is owner-only and fail-closed. This checklist prepares a release; it does not authorize a deployment, application submission, recruiter contact, email send, paid service, or automation.

## 1. Required release gate

From a clean checkout of `main`:

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

## 4. Readiness endpoints

After starting the intended release build, authenticate as the configured owner.

### Minimal health check

Open:

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

A failed health check is a release blocker. The endpoint remains read-only and owner-gated.

### Operational runtime preflight

Open:

```text
/api/runtime-readiness
```

This endpoint is also owner-only, GET-only and read-only. It is intentionally **zero-network**: it does not call search providers, AI providers, the cloud agent, Gmail OAuth, Gmail APIs, company sites or ATS discovery merely to calculate readiness.

The preflight:

- checks D1 through Scout's database layer;
- verifies the core Scout tables required by the first-run workflow;
- verifies the job-snapshot, approved-claim and outreach-revision immutability triggers;
- classifies search configuration, including free/included versus explicitly allowed metered use;
- reports search-result persistence policy separately;
- classifies AI routing without calling a model;
- classifies cloud-agent and browser-handoff configuration without contacting either service;
- reports Gmail draft handoff availability without refreshing Gmail OAuth or creating a draft;
- keeps application submission, email sending, CAPTCHA solving and private-contact scraping unavailable.

The response never includes raw API keys, OAuth tokens, shared secrets, owner IDs or configured endpoint URLs. A configured Gmail agent handoff is reported as unverified because the remote agent's Gmail OAuth is deliberately not probed by this endpoint.

Interpretation:

- `ready`: core database/schema/evidence protections are ready; optional capabilities may intentionally be disabled.
- `attention`: core is ready, but an optional capability has an incomplete, invalid or permission-blocked configuration.
- `blocked`: a required core database/schema/evidence protection is unavailable.

Do not make an `attention` item green by enabling metered usage or weakening a safety gate without separate approval.

## 5. Manual smoke check

Before release approval, verify as the owner:

1. Dashboard loads without a client runtime error.
2. `/setup` loads the Runtime Preflight panel without exposing secret values.
3. Claims tab loads and draft/approved/rejected states render correctly.
4. Jobs render resume alignment without missing-field crashes.
5. Internship Inbox can run bounded local/cloud discovery without bursting one ATS provider.
6. A discovered supported role can be upgraded to an immutable official snapshot.
7. Contact evidence remains `needs_review` until explicitly reviewed.
8. Outreach creation produces a draft only; nothing is sent.
9. Application preparation produces a review packet only; nothing is submitted.
10. A non-owner request is denied.
11. Missing `SCOUT_OWNER_USER_ID` fails closed.

## 6. Optional agent configuration

Cloud-agent/search/email-draft integrations are optional deployment surfaces and must stay disabled unless their exact configuration and safety review are intentional. Do not enable paid overage, automatic sending, automatic application submission, private-contact scraping, guessed emails, or uncontrolled discovery sources.

The runtime preflight is diagnostic only. It does not edit environment variables or verify provider credentials through live external requests.

## 7. Safe local demo tooling

Use the existing local demo commands rather than introducing another demo database path:

```bash
npm run scout:demo:status
npm run scout:demo:seed
npm run scout:demo:reset
```

The demo tooling is local-only and production execution is prohibited. The hosted runtime-readiness endpoint never calls demo seed/reset operations.

## 8. Release decision

A deploy is ready for explicit owner approval only when all of the following are true:

- `npm run verify:release` passes from a clean current checkout.
- target D1 migrations are confirmed current.
- `/api/health` returns `status: ok` under owner authentication.
- `/api/runtime-readiness` has no blocked core checks, and every `attention` item has been intentionally reviewed.
- owner-only and same-origin protections remain intact.
- the manual smoke check passes.
- there are no unreviewed deployment-environment secrets/bindings.
- no send/apply/automation capability has been enabled.

Deployment itself requires a separate explicit approval.
