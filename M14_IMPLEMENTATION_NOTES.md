# M14 — Opportunity Command Center

## Goal
Make Scout’s discovery, application and outreach systems usable as one owner-controlled decision queue instead of disconnected workspaces.

## What M14 adds
- Owner-only `/command-center` workspace.
- Deterministic safest-next-action queue for persisted roles using existing M7 fit/quality intelligence.
- Application packet, contact-review and outreach-draft state surfaced together.
- M13 capital/startup/ecosystem discovery surfaced in the same workspace.
- Explicit owner actions to seed official ecosystem recruiting targets and research bounded public recruiting/business contacts.
- Direct Gmail-draft creation for an already-approved role-specific outreach draft. The existing M11/M12 execution checks still revalidate snapshot, accepted contact, approved claims, recipient, body hash and verified identity at Gmail-draft creation time.
- Main workspace navigation links for both Command Center and Ecosystem.

## Deliberate trust boundaries
- Raw search-index results remain ephemeral. This avoids persisting unverified third-party snippets as evidence; a lead can be promoted only after resolving official institution/employer evidence through Scout’s existing pipelines.
- VC/accelerator portfolio boards remain lead/context surfaces until the actual startup/employer official careers or ATS posting is resolved.
- Unregistered ecosystem institutions remain review-only until the owner verifies/registers the official source.
- Direct fund/accelerator roles require official role evidence before application preparation.
- Public recruiting/business contact research is allowed from official sources with exact provenance; newly captured contacts remain `needs_review`.
- Wrong-purpose pitch/deal-flow/media/LP/founder-program inboxes remain excluded from recruiting use unless the official evidence explicitly says recruiting/careers.

## Safe actions now available from the Command Center
1. Search ecosystem surfaces for a review session.
2. Explicitly seed known official recruiting targets into the existing Company Outreach workflow.
3. Research bounded public recruiting/business contacts for those targets; candidates stay `needs_review`.
4. Continue to Company Outreach to select approved claims, generate personalized speculative outreach, and review the exact revision.
5. For role-specific outreach already approved as an exact revision, create/reuse a Gmail draft directly from the Command Center after freshness checks.

## Still prohibited
- Email sending.
- Application submission.
- Automatic contact acceptance.
- Automatic registration/trust of unknown sources.
- Guessed email patterns or personal/private contact scraping.
- LinkedIn recruiter-email scraping.
- CAPTCHA/login/rate-limit/access-control bypass.
- Resume-claim mutation or invented candidate facts.
- Automatic rejection of opportunities.

Application work intentionally outranks optional outreach work in the decision queue.
