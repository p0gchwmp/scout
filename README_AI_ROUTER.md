# Scout quality-first AI router

Scout routes language work across explicitly configured free/included capacity while keeping paid overage disabled by default. Deterministic evidence and approval boundaries stay in force regardless of model provider.

## Direct providers

Preferred Scout-specific variables:

```text
SCOUT_NIM_FREE_API_KEY
SCOUT_GROQ_FREE_API_KEY
SCOUT_GEMINI_FREE_API_KEY
SCOUT_CEREBRAS_FREE_API_KEY
SCOUT_OPENROUTER_FREE_API_KEY
```

Generic provider keys are ignored unless `SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS=1` is explicitly set. This prevents Scout from silently treating a credential with paid billing attached as free capacity.

Current direct routes prefer NVIDIA NIM, Groq and Gemini quality capacity, with Cerebras/OpenRouter fallback. Local Ollama remains the final offline fallback when available.

Run:

```powershell
npm run scout:ai:status
```

The status command prints provider IDs and route order without printing secrets.

## Quality mode

`high` is the default and performs a deliberate refinement pass for external-facing writing. Set `SCOUT_AI_QUALITY_MODE=balanced` to avoid a second model call when the first draft already passes deterministic writing checks.

## Poe included-points route

Poe can be added as an optional OpenAI-compatible fallback only when the owner explicitly designates the credential as included capacity:

```text
SCOUT_POE_INCLUDED_ONLY=1
SCOUT_POE_INCLUDED_API_KEY=...
SCOUT_POE_MODEL=Gemini-3.1-Pro
```

Optional endpoint override:

```text
SCOUT_POE_ENDPOINT_URL=https://api.poe.com/v1/chat/completions
```

Scout never purchases Poe points or enables billing.

## OmniRoute included-capacity gateway

Scout can consume an already-running OmniRoute OpenAI-compatible endpoint. It does not install OmniRoute, perform OAuth, import browser credentials, or change OmniRoute provider/billing settings.

```text
SCOUT_OMNIROUTE_INCLUDED_ONLY=1
SCOUT_OMNIROUTE_INCLUDED_API_KEY=...
SCOUT_OMNIROUTE_ENDPOINT_URL=http://127.0.0.1:20128/v1/chat/completions
SCOUT_OMNIROUTE_MODEL=cx/gpt-5.5
SCOUT_OMNIROUTE_ALLOW_LOOPBACK_DEV=1
```

The mandatory `SCOUT_OMNIROUTE_INCLUDED_ONLY=1` flag means the owner has configured the upstream gateway so Scout may use only free/subscription/included capacity. Scout does not verify or modify upstream billing, so the gateway remains an optional trust boundary rather than Scout's primary provider.

This is the path for pooling subscription-backed CLI/OAuth capacity when the owner explicitly chooses to configure it. Direct NIM/Groq/Gemini routes remain preferred so Scout is not dependent on a third-party gateway.

## Explicit single-provider compatibility

The older generic OpenAI-compatible configuration remains supported:

```text
SCOUT_AI_ENDPOINT_URL
SCOUT_AI_API_KEY
SCOUT_AI_MODEL
SCOUT_AI_COST_CLASS
```

All four are required together. `metered` remains blocked unless `SCOUT_ALLOW_METERED_AI=1` is separately and deliberately enabled.

## Safety

Models cannot invent contacts, use unapproved claims, answer sensitive application fields, submit applications, or send email. Provider failover and quality refinement do not relax these boundaries.
