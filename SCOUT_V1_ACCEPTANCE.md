# Scout v1 — Acceptance Contract

Scout v1 is accepted only when the branch release gate is green and the machine-checkable V1 acceptance tests pass.

## Accepted end-to-end workflow

1. Discover controlled-source and search-index leads, including capital/ecosystem lanes.
2. Treat search/portfolio-board results as leads rather than trusted employer evidence.
3. Independently resolve a selected lead to an official supported employer/ATS source before persistence as an application-ready opportunity.
4. Preserve immutable job snapshots and exact public-contact provenance.
5. Rank opportunity quality/fit and prepare application review packets from the current snapshot and approved candidate claims.
6. Revalidate current snapshot, verified reusable profile evidence and approved claim bindings before browser Safe Fill.
7. Research explicitly published public business/recruiting contacts; new contacts require owner review.
8. Draft low-volume personalized outreach from accepted contact evidence and approved claims.
9. Require approval of the exact outreach revision and revalidate snapshot/contact/claims/body/recipient/verified identity before Gmail draft creation.
10. Keep email sending and employer-side application submission manual.
11. Record external submissions, explicit recruiter outcomes and user-chosen follow-up dates without inferring recruiter behavior.
12. One explicit Run Scout action may execute safe discovery/research/preparation work, but it may not cross a new human trust boundary.

## Non-negotiable V1 safety invariants

- Private, owner-only access. Missing owner configuration fails closed outside explicit local development rules.
- Same-origin checks on browser mutation routes.
- Job snapshots immutable.
- Approved claims immutable and approval-bound.
- Outreach revisions pinned to immutable job evidence, accepted contact evidence and approved claim IDs.
- Search snippets are not trusted application/contact evidence.
- No guessed recruiter emails or personal-contact harvesting.
- No login/CAPTCHA/rate-limit bypass.
- No automatic contact acceptance, outreach approval, email sending, offer acceptance or application submission.

## Release acceptance

`npm run verify:release` is the authoritative repository gate. It includes unit tests, build/render checks, lint, both migration smoke tests, schema generation cleanliness, a second build, diff checks and repository-status checks. GitHub Scout CI must pass this command on the final M18 head before Scout v1 is called release-green.

M18 does not deploy Scout and does not activate any recurring automation or paid service.
