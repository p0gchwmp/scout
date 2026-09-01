# M25 — Official Contact Source Registry Expansion

## Goal
Expand Scout's provenance-first contact research across more **official first-party surfaces** without widening into arbitrary third-party scraping, guessed addresses, private contact harvesting, or automated outreach.

## Existing capability reused
Scout's `contact_evidence.source_type` already supports:
- `official_job_posting`
- `official_careers`
- `official_contact`
- `official_company`
- `official_team`
- `official_event`
- `official_press`

M25 uses those existing types; no schema or migration is required.

## Changes
1. Add `lib/scout/contact-source-registry.ts`
   - single explicit registry for supported official source types
   - deterministic URL classification
   - bounded first-party crawl seeds
   - provenance-sensitive ranking bonuses
2. Update `agent/contact-research.ts`
   - keep HTTPS + registered company-domain/subdomain requirement
   - keep company-domain mailbox requirement
   - keep consumer mailbox rejection
   - keep wrong-purpose mailbox rejection
   - keep named mailbox recruiting-context requirement
   - classify exact provenance as job/careers/team/event/contact/press/company
   - expand first-party crawl cap from 8 to 12 pages, using only 10 fixed high-value seeds so discovered detail pages still fit inside the bound
   - continue to ignore search-provider results and arbitrary third-party pages
3. Update `lib/scout/contact-intelligence.ts`
   - use the registry's bounded provenance bonus
   - recruiting/context evidence still dominates ranking
   - provenance alone cannot turn an unrelated mailbox into a strong recruiting contact
4. Add M25 regression tests.

## Explicitly unchanged safety boundaries
- no email guessing
- no LinkedIn scraping
- no data brokers
- no consumer mailbox harvesting
- no arbitrary third-party public page fetching
- no CAPTCHA/login/rate-limit bypass
- no automatic email sending
- no automatic applications
- all discovered contact evidence remains review-bound downstream

## Offline validation
- registry tests: 4/4 passed
- crawler/integration safety tests: 4/4 passed
- combined M25 tests: 8/8 passed

## Git state
Committed only after explicit owner approval. Release acceptance still requires the repository CI/release gate.
