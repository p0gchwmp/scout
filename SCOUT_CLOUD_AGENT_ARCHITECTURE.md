# Scout cloud-first agent architecture

Scout is a private internship discovery and outreach copilot. Local mode remains a development convenience; the product target is an always-online private web application with an internet-connected agent worker.

## Deployment split

### Scout web + API

Keep the existing Vinext + Cloudflare Worker + D1 application as the owner-only control plane unless a future migration is justified. It already owns authentication, immutable job snapshots, candidate claims, contact evidence, application packets, and outreach draft records.

Responsibilities:
- owner-only UI and API;
- job/source/contact/claim/application persistence;
- same-origin browser mutation checks;
- immutable job snapshots;
- review/approval state;
- no autonomous send or application submission.

### Scout agent worker

Run a separate internet-connected Node service for longer-running work. Heroku Student or Microsoft Azure Student are suitable deployment targets; the exact host should remain replaceable.

Responsibilities:
- scheduled controlled-source discovery;
- official ATS/company-page fetching with SSRF/redirect/size/time protections;
- job-resolution and normalization;
- public business/recruiter email candidate extraction from official pages;
- AI-assisted classification and personalization;
- Gmail draft creation after the contact/draft prerequisites are satisfied;
- retry/backoff and task telemetry.

The worker must never receive arbitrary browser-supplied fetch URLs. Fetch targets come from the controlled source registry or from provenance-reviewed official URLs persisted by Scout.

## Agent task classes

1. `discover_internships`
   - scan registered public ATS/company sources;
   - find internship/early-career roles relevant to India/remote preferences;
   - preserve source URL and timestamps.

2. `resolve_job`
   - fetch the official posting;
   - normalize and capture an immutable snapshot;
   - preserve provider/external ID/canonical URL/content hash.

3. `research_contacts`
   - inspect only approved official/public business sources;
   - extract explicitly published business/recruiting email addresses;
   - store exact URL, excerpt, timestamp, source type and suitability;
   - new evidence remains `needs_review`.

4. `draft_outreach`
   - input is pinned to the immutable job snapshot, accepted contact evidence and approved claim IDs;
   - AI may personalize wording but may not add unsupported credentials, metrics, authorization, availability, referrals or experience;
   - store provider/model metadata, prompt/input hash, selected claim IDs and final body hash.

5. `create_gmail_draft`
   - create a Gmail Draft only after the Scout draft is reviewable and the recipient is accepted contact evidence;
   - no Scout route or worker capability may call Gmail `drafts.send` or `messages.send` unless a separately approved send milestone is implemented and safety-reviewed.

## AI provider boundary

Do not bind Scout to one model vendor. Use an adapter with a structured JSON contract. Provider configuration must be server-side only.

Required policy:
- default `SCOUT_ALLOW_METERED_AI=0`;
- provider failures fall back to deterministic/non-AI behavior where possible;
- never silently enable paid overage;
- AI never invents an email address;
- AI classifies/explains extracted evidence rather than replacing provenance;
- outreach inputs contain only approved candidate claims.

GitHub Models is not a target because the inference service was retired in July 2026. Azure AI/Foundry or another explicitly configured provider can sit behind the adapter.

## Service-to-service security

The agent and Scout control plane use a dedicated shared secret or asymmetric service credential, separate from Ryan's browser authentication.

Every agent mutation should include:
- task ID;
- timestamp/expiry;
- request body hash;
- HMAC/signature;
- idempotency key.

Scout rejects expired/replayed/invalid agent mutations and continues to enforce immutable snapshot/contact/claim rules server-side.

## Gmail integration

Use OAuth 2.0 server-side. Store refresh credentials encrypted/secret-managed by the deployment platform. Request the narrowest practical Gmail scope. `gmail.compose` supports draft creation but also technically authorizes sending, so Scout's code must intentionally expose only `users.drafts.create` during the draft-only milestone.

## Scheduling

Scheduled discovery is a cloud operation, not a browser tab feature. A hosted scheduler invokes the agent on a modest cadence, for example several times per day, with per-source backoff and idempotency. Do not use GitHub Actions as the primary runtime; CI minutes should remain for tests/builds.

## Hosting strategy

Near term:
- Cloudflare Worker + D1: Scout owner-only control plane;
- Heroku Student or Azure Student: optional Node agent worker when long-running/network behavior warrants it;
- provider-neutral AI adapter;
- Gmail OAuth draft creation.

Do not replatform the D1-backed control plane merely to consume a student hosting credit. Move components only when the operational benefit outweighs migration risk.

## Still prohibited without separate approval

- email sending;
- application submission;
- LinkedIn/private-email scraping;
- guessed email patterns;
- CAPTCHA/login/access-control bypass;
- paid overage;
- public deployment or weakened owner authentication.
