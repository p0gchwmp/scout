# M27 — Optional lead-context provider integrations

## Scope

M27 adds a manual, review-only enrichment lane for public LinkedIn person/company/job URLs.

The result is **context**, not contact evidence. Provider-returned email, phone, WhatsApp and address fields are not represented in Scout's sanitized lead-context schema and cannot be promoted directly into outreach evidence.

## Provider support

### Apify — live optional lookup

Configured only when both are present:

- `SCOUT_APIFY_API_TOKEN`
- `SCOUT_APIFY_LINKEDIN_ACTOR_ID`

The configured actor must accept a `profileUrls` array. Scout sends exactly one manually supplied LinkedIn URL per invocation.

Example:

```bash
SCOUT_APIFY_API_TOKEN=... \
SCOUT_APIFY_LINKEDIN_ACTOR_ID=simpleapi/linkedin-profile-scraper \
npm run scout:lead-context -- --provider apify --url https://www.linkedin.com/in/example-person
```

No Apify account, actor, paid plan, schedule, or token is created or activated by Scout.

### PhantomBuster / Bright Data / Scrapingdog — sanitized import adapters

M27 accepts exported JSON from these providers through the same sanitizer. Scout does not launch their browser/session/unblocking workflows.

```bash
npm run scout:lead-context -- \
  --provider phantombuster \
  --url https://www.linkedin.com/in/example-person \
  --file ./provider-output.json
```

`brightdata`, `scrapingdog`, and `generic` are accepted in the same form.

### Unify — optional sanitized record sink

Unify is integrated through its Data API as an optional destination for the already-sanitized context record.

Required configuration:

- `SCOUT_UNIFY_API_KEY`
- `SCOUT_UNIFY_OBJECT`

The Unify object must already exist and expose attributes matching:

- `source_provider`
- `source_url`
- `profile_type`
- `full_name`
- `headline`
- `company`
- `role`
- `location`
- `summary`
- `experience_json`
- `education_json`
- `observed_at`

Example:

```bash
SCOUT_UNIFY_API_KEY=... \
SCOUT_UNIFY_OBJECT=scout_lead_context \
npm run scout:lead-context -- \
  --provider apify \
  --url https://www.linkedin.com/in/example-person \
  --push-unify
```

Scout does not create or modify the Unify object schema automatically.

## Persisted context schema

Only these fields leave the provider adapter:

- provider
- LinkedIn URL
- profile type
- full name
- headline
- company
- role
- broad location
- professional summary
- compact experience summaries
- compact education summaries
- observed timestamp

No provider-returned email, phone, WhatsApp, street address, cookies, session identifiers, or raw provider payload are included.

## Existing official email discovery remains authoritative

Scout's existing contact-research path continues to collect explicitly published first-party business/recruiting email addresses from registered official company/careers/contact/team/event/press pages with exact provenance and human review.

M27 context cannot bypass that evidence requirement.
