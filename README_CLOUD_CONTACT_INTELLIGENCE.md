# Scout cloud contact intelligence

Scout's cloud design does not depend on local Ollama. Ollama is a development fallback only.

## Runtime split

The owner-only Scout web app/Worker needs the existing agent bindings:

```text
SCOUT_AGENT_BASE_URL=https://<your-private-agent-origin>
SCOUT_AGENT_SHARED_SECRET=<64-hex shared secret>
```

The Node Scout agent service holds external-service credentials. Do not expose provider or Gmail secrets to the browser.

## Cloud AI

Configure at least one Scout-specific free/included provider key on the agent service when you want AI contact triage and higher-quality outreach:

```text
SCOUT_NIM_FREE_API_KEY
SCOUT_GROQ_FREE_API_KEY
SCOUT_GEMINI_FREE_API_KEY
SCOUT_CEREBRAS_FREE_API_KEY
SCOUT_OPENROUTER_FREE_API_KEY
```

Scout tries configured cloud routes before any local Ollama route. Generic provider keys are ignored unless `SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS=1` is explicitly enabled. Metered AI remains blocked unless separately enabled and reviewed.

Without any AI provider, Scout still performs deterministic discovery, official-source resolution, contact extraction/ranking, application evidence preparation, and human contact review. Accepted-contact outreach falls back to the deterministic approved-claims template rather than requiring the laptop.

## Gmail draft handoff

The Node agent can create/reuse Gmail drafts when these OAuth credentials are configured:

```text
SCOUT_GMAIL_CLIENT_ID
SCOUT_GMAIL_CLIENT_SECRET
SCOUT_GMAIL_REFRESH_TOKEN
```

The Gmail capability is draft-only. Scout has no Gmail send endpoint.

Required workflow:

1. immutable official job snapshot;
2. explicitly published company/recruiting email with exact provenance;
3. human accepts contact evidence;
4. Scout drafts outreach from approved claim IDs;
5. human approves the exact outreach revision;
6. Scout may create/reuse a Gmail draft;
7. user manually sends from Gmail.

## Recruiter / LinkedIn clues

`/contacts` accepts an optional recruiter name, role and LinkedIn profile URL as browser-local ranking context. The LinkedIn URL is not fetched, scraped or stored as sendable evidence. Scout independently searches only the verified first-party company domain for published business emails.

Disallowed in this workflow:

- scraping LinkedIn emails or hidden profile data;
- guessing `first.last@company.com` patterns;
- data-broker enrichment without a separate review/approval;
- automatic contact acceptance;
- mass cold email;
- automatic email sending.
