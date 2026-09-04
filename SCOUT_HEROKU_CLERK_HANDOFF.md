# Scout Heroku + Clerk Portability Handoff

This document is the continuation brief for Scout's move from a ChatGPT-Sites/Cloudflare-only runtime to an always-on private Heroku deployment using Clerk authentication while preserving Scout's existing D1 data model and safety boundaries.

This handoff is context, not blanket permission. Ryan has explicitly approved pursuing a private cloud deployment so Scout can be accessed from any device, and has claimed the GitHub Student Heroku and Clerk benefits. Do not enable email sending, application submission, recruiter contact, paid AI overage, automations, public access, private-contact scraping, or weakened authentication.

## 1. Repository and current branch

Repository:

`p0gchwmp/scout`

Local path historically used by Ryan:

`C:\Users\GIGABYTE\Documents\Codex\2026-08-12\i-wanna-build-an-ai-bot`

Canonical base branch:

`main`

Portability work branch:

`feat/heroku-node-portability`

Known base at start of portability work:

`fff389c71c09d56e1eb28fa47ac48cafdd6eedf7`

Branch head immediately before this handoff file was added:

`3978bd22d79446650e5ba59e56e6f9d3a57cf6e3`

Always verify live state with Git rather than relying on these SHAs.

## 2. Product mission

Scout is Ryan Vivek Mahajan's private internship discovery and outreach-drafting copilot. It should:

- discover legitimate internships and early-career roles from controlled/registered sources;
- preserve exact source evidence and immutable job snapshots;
- identify legitimate explicitly-published public business/recruiter contact channels with provenance;
- compare roles against Ryan's approved candidate claims only;
- prepare application review packets without submitting them;
- draft low-volume personalized outreach for Ryan to review;
- never send/apply automatically unless separately approved and safety-reviewed.

## 3. Ryan candidate boundaries

Do not invent credentials, metrics, results, work authorization, driver's licence, referrals, grades, or experience.

Known profile:

- Ryan Vivek Mahajan
- IIM Sambalpur Management & Public Policy undergraduate
- inaugural cohort 2025-2029
- from Jammu
- target roles: India/remote internships across product, startups, business, operations, finance/economics, public policy, and health-tech

Claim boundaries:

- GMC Jammu: adverse-drug-reaction data review, technical documentation, antibiotic-price desk research.
- Hand-hygiene work: pilot design/materials prepared; fieldwork planned/resuming, not completed.
- Aastha clinic/CMS: product direction/design and AI-assisted implementation; not sole manual coding.
- Clinic operations prototype: Node.js/Express/SQLite, workflow mapping, edge cases, automated tests.
- Scout: product requirements, safety model, prototype validation; not autonomous application sending.
- Semester I CGPA remembered as 8.25; verify before any external use.

## 4. Security invariants

Never weaken these:

1. Scout is private and owner-only.
2. Missing/wrong owner identity must fail closed.
3. Pages and APIs require owner authentication.
4. Browser mutations require same-origin checks.
5. Discovery sources remain controlled/registered.
6. Job snapshots are immutable evidence.
7. Candidate claims are versioned and approval-bound.
8. Contact evidence is provenance-bound and defaults to `needs_review`.
9. Outreach drafts remain pinned to immutable job snapshots, accepted contact evidence, and approved claim IDs.
10. No email-send route or autonomous application submission may be enabled.
11. Local-development auth variables must never be copied into production.
12. Do not put long-lived secrets in Git or browser-visible code.

Contact discovery remains provenance-first public business contact discovery, not spam scraping. Do not mass scrape LinkedIn, harvest private/personal contact details, guess email patterns, use data brokers without separate approval, bypass login/CAPTCHA/rate limits, or mass cold-email.

## 5. Why the hosting architecture changed

The original app is tightly integrated with ChatGPT Sites / Cloudflare Workers:

- `worker/index.ts` injects trusted ChatGPT identity headers.
- `app/chatgpt-auth.ts` reads those internal headers.
- `db/index.ts` uses Drizzle's D1 driver through `cloudflare:workers`.
- many API routes import `env` from `cloudflare:workers`.
- `.openai/hosting.json` defines `DB` and `FILES` bindings.

Ryan's Windows local Vinext dev runtime repeatedly exited with code 1 after otherwise-successful requests. By the end of debugging, the following all worked before Vinext exited:

- dashboard/page rendering;
- discovery import 200;
- official lead resolution 200;
- jobs/sources/claims/profile/contacts/applications/outreach APIs 200;
- shortlist rendering 200;
- `/health` 200.

That isolated the remaining issue to local Vinext/Windows runtime stability rather than Scout's core data/API logic. The product goal is now an always-on private cloud runtime rather than making Ryan depend on `npm run dev`.

## 6. Chosen Heroku architecture

Do not perform a broad D1-to-Postgres rewrite for the first Heroku deployment.

Chosen first production shape:

```text
Internet
  -> Heroku Basic/Cedar web dyno
  -> Vinext Node production runtime
  -> Clerk session verification
  -> Ryan-only owner gate
  -> Scout app routes
  -> Cloudflare D1 through authenticated D1 REST API

Same dyno:
  -> private Scout agent bound only to 127.0.0.1:<ephemeral port>
  -> ephemeral 256-bit HMAC shared secret generated at boot
  -> no public agent listener
```

Why retain D1 initially:

- Scout's schema is SQLite/D1-specific and large.
- snapshot/claim/contact-evidence semantics are already tested around D1.
- the API layer has many `cloudflare:workers` environment imports.
- a Postgres rewrite would be a much larger migration with higher evidence-integrity risk.
- Scout currently has no `db.transaction()` usage, so the D1 REST compatibility layer does not need to fake cross-request transactions.

A later Postgres migration can be considered separately after the hosted Node runtime is proven.

## 7. Current portability implementation

At the time of this handoff, `feat/heroku-node-portability` is 35 commits ahead of `main` and changes/adds approximately these surfaces:

### Heroku process/runtime

- `Procfile`
  - release: `node --experimental-strip-types scripts/scout-heroku-migrate.mjs`
  - web: `node scripts/scout-heroku-run.mjs`
- `scripts/scout-heroku-run.mjs`
  - requires production mode + Clerk + remote D1 configuration;
  - rejects local-dev auth variables;
  - validates hosted HTTPS origin;
  - starts the private Scout agent on `127.0.0.1` with an ephemeral port;
  - generates an ephemeral 64-hex HMAC secret;
  - sets `SCOUT_AGENT_ALLOW_LOCAL_RUNTIME=1` internally only;
  - starts `vinext start` on Heroku's `$PORT` and `0.0.0.0`;
  - couples web/agent lifecycle so either failure stops the dyno.
- `scripts/scout-node-build.mjs`
  - builds with the Node runtime target.
- `package.json`
  - adds `build:node` and `heroku-postbuild`;
  - release verification now also proves the Node target build.

Heroku Cedar should retain devDependencies for the first deployment because `vinext` is currently a devDependency and the production server needs that CLI. Configure:

`NPM_CONFIG_PRODUCTION=false`

Do not silently move packages or regenerate the lockfile without running the full release gate.

### Node target / Cloudflare environment compatibility

- `vite.config.ts`
  - preserves the existing Cloudflare/Sites build by default;
  - when `SCOUT_RUNTIME_TARGET=node`, removes the Cloudflare Vite plugin/Sites plugin path and aliases `cloudflare:workers` to a Node shim.
- `lib/scout/node-cloudflare-env.ts`
  - provides the Node-side environment object expected by existing routes;
  - wires `DB` to the remote D1 compatibility implementation rather than a fake local DB.

### Remote D1

- `db/remote-d1.ts`
  - implements the D1 surface Drizzle needs over Cloudflare's authenticated D1 HTTP API;
  - supports prepare/bind/run/all/raw/batch semantics used by Scout;
  - must fail closed on invalid config/non-success responses;
  - secrets remain server-side.
- `scripts/scout-heroku-migrate.mjs`
  - Heroku release-phase migration runner;
  - creates/uses `d1_migrations` ledger;
  - refuses a DB ledger entry not present in the release;
  - applies each migration in an atomic D1 batch together with its ledger insert;
  - currently runs under `--experimental-strip-types` because it imports TypeScript remote-D1 code.

Required remote-D1 environment values:

- `CLOUDFLARE_ACCOUNT_ID`
- `SCOUT_D1_DATABASE_ID`
- `SCOUT_D1_API_TOKEN`

Use a least-privilege Cloudflare API token for the intended D1 database/account. Never commit it.

### Clerk authentication

- `lib/scout/clerk-auth.ts`
  - manually verifies Clerk session JWTs using the instance public JWT key;
  - signature/time/issuer/authorized-party validation must remain strict.
- `proxy.ts`
  - activates only when `SCOUT_AUTH_PROVIDER=clerk`;
  - protects Scout owner pages and APIs;
  - rejects missing owner config;
  - verifies the Clerk session before constructing Scout's internal identity headers;
  - deletes Internet-supplied identity headers before rebuilding them;
  - compares verified Clerk `user_...` ID against `SCOUT_OWNER_USER_ID`;
  - redirects unauthenticated page requests to `/sign-in`;
  - APIs fail with 401/403 rather than redirecting.
- `app/sign-in/[[...sign-in]]/*`
- `app/sign-out/*`
- `lib/scout/clerk-browser.ts`
  - browser-side Clerk UI bootstrapping.
- `app/chatgpt-auth.ts`
  - adapted so the same Scout app code can consume trusted identity injected either by ChatGPT Sites or Clerk proxy.

Required auth environment values:

- `SCOUT_AUTH_PROVIDER=clerk`
- `SCOUT_OWNER_USER_ID=<Ryan's exact Clerk user_... id>`
- `SCOUT_PUBLIC_ORIGIN=https://<exact-heroku-host-or-custom-domain>`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>`
- `CLERK_JWT_KEY=<Clerk instance public JWT verification key>`
- `CLERK_ISSUER=<exact Clerk issuer>`

Do not guess `SCOUT_OWNER_USER_ID`. Ryan must sign into Clerk and use his actual Clerk user ID.

### Private same-dyno Scout agent

`lib/scout/agent-runtime.ts` adds a separate `SCOUT_AGENT_ALLOW_LOCAL_RUNTIME` path for the Heroku launcher.

Important rule:

- user-configured production environment must not set the local-runtime flag;
- only the launcher generates it;
- when enabled, the agent URL must be exactly HTTP `127.0.0.1` with an explicit port and no credentials/path/query/hash;
- the generic agent request remains HMAC-signed;
- `SCOUT_AGENT_ALLOW_LOOPBACK_DEV` remains forbidden in production.

The purpose is to keep the existing hosted-agent security rule intact while allowing a private same-process-group service inside one Heroku dyno.

## 8. Existing tests added for portability

Portability branch includes tests covering at least:

- `tests/clerk-auth.test.ts`
- `tests/remote-d1.test.ts`
- `tests/heroku-portability.test.ts`

Recent branch commits also include fixes/tests for:

- typed Heroku release migration invocation;
- `--experimental-strip-types` compatibility;
- remote D1 Node strip-types compatibility;
- shared agent gate assertions.

Do not claim the full branch is green until a PR release gate runs on the current head.

## 9. Current immediate next step

The branch has not yet been merged into `main` and, at the time this handoff was written, no open PR existed for `feat/heroku-node-portability`.

Next agent should:

1. Compare `main...feat/heroku-node-portability` and inspect the changed files.
2. Open one PR from `feat/heroku-node-portability` to `main` to trigger exactly one full Scout CI release gate.
3. Keep the branch frozen while CI runs.
4. If CI fails, inspect the exact failing job logs and patch only the real failure.
5. Re-run the single PR gate on the new exact head.
6. Do not merge until the exact current head is green.
7. Once green, squash-merge under Ryan's existing engineering authorization.
8. Then perform the Heroku/Clerk configuration and deployment smoke steps below.

## 10. Heroku + Clerk setup still required after code is green

Ryan has already claimed GitHub Student benefits for Heroku and Clerk, but application/environment configuration still needs to be completed.

Expected Heroku setup:

- create a private Scout Heroku app;
- use a supported Cedar stack such as `heroku-24`;
- deploy from the private GitHub repo/current `main` only after the portability PR is merged;
- enable/configure `NPM_CONFIG_PRODUCTION=false` for this first build;
- set all required production config vars;
- do not set local-development auth variables;
- let the release phase apply D1 migrations before the web dyno starts.

Expected Clerk setup:

- create/choose the Scout Clerk application;
- use Ryan's actual Clerk account/user as the only approved owner identity;
- record the exact `user_...` ID into Heroku `SCOUT_OWNER_USER_ID`;
- configure the Heroku production origin in Clerk allowed origins/redirect settings;
- use the correct publishable key, issuer, and JWT public verification key;
- do not use a shared password bypass or public fallback route.

Expected Cloudflare setup:

- use the intended production D1 database;
- create a least-privilege D1 API token;
- set account ID/database ID/token only as Heroku secrets/config vars;
- run/review migrations before accepting production traffic.

## 11. Production smoke gate

After deployment, do not call it ready until all of the following are true:

- unauthenticated owner pages redirect to Clerk sign-in;
- unauthenticated APIs return 401;
- non-owner Clerk account returns 403;
- missing/wrong `SCOUT_OWNER_USER_ID` fails closed;
- Ryan's Clerk account can load `/` and `/shortlist`;
- `/health` and `/api/health` report healthy under owner authentication;
- `/api/runtime-readiness` has no blocked core checks;
- D1 data persists across dyno restart;
- existing claims/jobs/snapshots remain readable;
- discovery can run through the private same-dyno agent;
- contact candidates remain `needs_review`;
- application preparation creates a review packet only;
- outreach remains a draft only;
- email sending remains unavailable;
- application submission remains unavailable;
- no agent port is reachable publicly.

## 12. Local data warning

Ryan's previous Windows local data lives in local Wrangler/D1 state and is not automatically the same as a new remote production D1 database.

Do not silently claim local jobs/claims have been migrated to cloud. Decide explicitly whether to:

- start the hosted D1 clean and re-discover/re-approve evidence; or
- create a reviewed one-time migration/export/import path preserving provenance and version semantics.

Never copy local `.wrangler` files directly into production.

## 13. Claims / shortlist product issue still pending

Before the hosting pivot, Ryan reported:

- High Priority shortlist was empty;
- roughly 40 claims/profile facts were unverified/draft.

This is expected from Scout's evidence policy: unapproved claims cannot support resume alignment, so roles may remain `unranked` / `Needs approved claims` rather than High Priority.

After the hosted app is stable, review a small core set of factual claims first rather than approving everything blindly. Recommended first set:

- GMC Jammu ADR/documentation/price-research claim;
- hand-hygiene pilot-preparation claim with no completed-results wording;
- Aastha product/design + AI-assisted implementation claim;
- clinic operations Node/Express/SQLite prototype claim;
- Scout product requirements/safety/prototype-validation claim.

Keep CGPA unapproved until externally verified.

## 14. Validation policy

Before editing locally:

```bash
git status --short --branch
npm run test:unit
npm run lint
```

Before proposing/merging a commit:

```bash
npm test
npm run lint
python tests/migration-smoke.py
npm run db:generate
npm run build
git diff --check
git status --short --branch
git diff --stat
```

For this portability branch, also prove the Node target through the repository release gate (`npm run verify:release`), which now includes `npm run build:node`.

When working only through the GitHub connector, do not claim local tests were run. Use the exact-head GitHub CI release gate as evidence and say so.

## 15. Git/GitHub usage discipline

Ryan asked to conserve GitHub/Git usage. Prefer:

- one feature branch;
- one PR;
- batched fixes;
- exact-head CI;
- squash merge;
- no pointless reruns.

Do not repeat the earlier mistake of staging a regression test directly on `main`; branch first.

## 16. What not to do next

Do not:

- rewrite all of D1 to Postgres before proving the Node/Heroku path;
- weaken auth to make deployment easy;
- expose the private agent publicly;
- enable `SCOUT_AGENT_ALLOW_LOOPBACK_DEV` in production;
- invent Clerk user IDs or issuer values;
- place Cloudflare/Clerk secrets in Git;
- make Scout public so ChatGPT can browse it anonymously;
- add email send/apply routes;
- activate automations or paid providers;
- claim Heroku deployment is complete before the actual hosted smoke test passes.

## 17. Resume point

Continue from the current `feat/heroku-node-portability` head. The immediate engineering task is to open the PR and run the release gate on the accumulated portability work. Once CI is green, merge, then configure the real Heroku + Clerk + remote D1 environment and deploy privately under the already stated cloud-hosting goal.
