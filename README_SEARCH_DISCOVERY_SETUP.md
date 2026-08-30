# Scout broad web-search discovery

Scout's cloud agent can supplement the controlled Greenhouse/Lever catalog with a server-side web-search index. This is intended to find public internship leads from job boards, ATS pages, direct company careers pages, and application forms without scraping search-result HTML or private profiles.

The current adapter supports Brave Search through its documented web-search API. It is disabled until explicitly configured.

## Safety model

- Search queries are fixed in `agent/search-discovery.ts`; callers cannot supply arbitrary queries.
- Search results are leads, not verified job snapshots.
- LinkedIn, Glassdoor, Internshala, Wellfound, Unstop and similar results remain lead/context evidence until Scout resolves official employer/job evidence.
- Search does not fetch LinkedIn profiles or private contact data.
- Tally/Typeform/Fillout/Google Forms results are application surfaces only; they still require upstream company/job provenance before Safe Fill.
- Metered search is disabled unless `SCOUT_ALLOW_METERED_SEARCH=1` is explicitly configured.
- Search-result persistence is separately gated. With persistence disabled, broad search-index discovery stays off, but Scout may use fixed search queries ephemerally to locate a candidate official ATS posting, re-fetch that posting from the ATS, and persist only the verified official snapshot.
- Ephemeral official-resolution search does not unlock company-domain evidence or contact research. Company-domain search evidence remains persistence-gated; unresolved sources stay `unresolved.invalid` until independently verified.

## Environment

Configure these only on the internet-connected Scout agent service:

```text
SCOUT_SEARCH_PROVIDER=brave
SCOUT_SEARCH_API_KEY=<server-side secret>
SCOUT_SEARCH_COST_CLASS=free_or_included
SCOUT_SEARCH_RESULT_PERSISTENCE_ALLOWED=0
```

Keep `SCOUT_SEARCH_RESULT_PERSISTENCE_ALLOWED=0` when search is only being used transiently to resolve an already-discovered lead to an official ATS posting. Set it to `1` only when persistence of search-index lead/domain evidence has been separately reviewed and approved.

Do not set this unless metered usage has been explicitly approved:

```text
SCOUT_ALLOW_METERED_SEARCH=1
```

The API key must never be placed in browser code, the extension, committed `.env` files, or Cloudflare client assets.

## Fixed discovery surfaces

Current fixed queries cover:

- LinkedIn job pages
- Glassdoor
- Internshala
- Wellfound
- Unstop
- Cutshort / Foundit
- Workday / `myworkdayjobs`
- BambooHR
- Ashby
- Workable
- SmartRecruiters
- Lever / Greenhouse public postings
- Teamtailor / Recruitee / Breezy / JazzHR / Pinpoint / Personio
- Tally
- Typeform
- Fillout
- Google Forms
- Jotform
- Microsoft Forms
- direct company careers/job pages

The result classifier then applies Scout's platform policy registry to decide whether the lead can be structurally resolved, needs browser capture, or must remain lead-only.

## Provider reference

Brave Search API web-search endpoint:

`https://api.search.brave.com/res/v1/web/search`

Documentation:

`https://api-dashboard.search.brave.com/api-reference/web/search/get`

Scout does not create an account, subscribe to a plan, or enable metered usage automatically.
