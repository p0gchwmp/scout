# Scout quality-first AI router

Scout can route AI work across multiple free/included providers while keeping paid overage disabled by default.

## Route policy

Structured classification/extraction prefers:

1. Groq — `qwen/qwen3.6-27b`
2. NVIDIA NIM — `nvidia/nemotron-3.5-lightning-30b-a3b`
3. Groq — `openai/gpt-oss-120b`
4. Gemini — `gemini-3.7-flash`
5. NVIDIA NIM — `deepseek-ai/deepseek-v4-flash-0731`
6. NVIDIA NIM — `nvidia/nemotron-3-ultra-550b-a55b`
7. Cerebras — `gpt-oss-120b`
8. OpenRouter — `openrouter/free`
9. local Ollama fallback

Writing/reasoning prefers:

1. NVIDIA NIM — `deepseek-ai/deepseek-v4-flash-0731`
2. NVIDIA NIM — `nvidia/nemotron-3-ultra-550b-a55b`
3. Groq — `openai/gpt-oss-120b`
4. Gemini — `gemini-3.7-flash`
5. NVIDIA NIM — `nvidia/nemotron-3.5-lightning-30b-a3b`
6. Cerebras — `gpt-oss-120b`
7. Groq — `qwen/qwen3.6-27b`
8. OpenRouter — `openrouter/free`
9. local Ollama fallback

Scout stops at the first valid result. It does not call every model by default. Provider/network/quota/schema failures fall through to the next configured candidate.

## Provider keys

Preferred Scout-specific variables are:

```text
SCOUT_NIM_FREE_API_KEY
SCOUT_GROQ_FREE_API_KEY
SCOUT_GEMINI_FREE_API_KEY
SCOUT_CEREBRAS_FREE_API_KEY
SCOUT_OPENROUTER_FREE_API_KEY
```

These variable names are intentionally explicit: configure them only with credentials you intend Scout to treat as free/included/no-extra-billing capacity.

If your existing harness already exposes standard provider variables, Scout can reuse them only after an explicit opt-in:

```powershell
$env:SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS = "1"
```

With that flag Scout may read:

```text
NVIDIA_API_KEY or NGC_API_KEY
GROQ_API_KEY
GEMINI_API_KEY or GOOGLE_API_KEY
CEREBRAS_API_KEY
OPENROUTER_API_KEY
```

Without the opt-in flag, generic provider keys are ignored.

## Local fallback

`npm run dev` probes loopback Ollama and, when available, registers the best detected local model as the final fallback. It does not replace configured cloud providers.

## Explicit single-provider compatibility

The older explicit configuration remains supported:

```text
SCOUT_AI_ENDPOINT_URL
SCOUT_AI_API_KEY
SCOUT_AI_MODEL
SCOUT_AI_COST_CLASS
```

If any explicit single-provider field is configured, all four are required. `metered` remains blocked unless `SCOUT_ALLOW_METERED_AI=1` is separately and deliberately enabled.

## Safety boundaries

The router does not change Scout's evidence rules. Models cannot invent contacts, use unapproved candidate claims, answer sensitive application fields, submit applications, or send email. Provider failover never relaxes those boundaries.
