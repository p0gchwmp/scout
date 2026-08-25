import { createStructuredAiProvider } from "../lib/scout/ai-provider.ts";
import { createQualityAiRouter, type RoutedAiCandidate } from "./ai-router.ts";

const NIM_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const CEREBRAS_ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_MODELS = Object.freeze({
  nimLightning: "nvidia/nemotron-3.5-lightning-30b-a3b",
  nimReasoning: "deepseek-ai/deepseek-v4-flash-0731",
  nimUltra: "nvidia/nemotron-3-ultra-550b-a55b",
  groqFast: "qwen/qwen3.6-27b",
  groqReasoning: "openai/gpt-oss-120b",
  gemini: "gemini-3.7-flash",
  cerebras: "gpt-oss-120b",
  openrouter: "openrouter/free",
} as const);

function value(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() ?? "";
}

function required(name: string, raw: string | undefined) {
  const candidate = raw?.trim() ?? "";
  if (!candidate) throw new Error(`${name} is required for Scout AI tasks`);
  return candidate;
}

function highQualityMode(environment: NodeJS.ProcessEnv) {
  return value(environment, "SCOUT_AI_QUALITY_MODE").toLowerCase() !== "balanced";
}

function candidate(input: {
  id: string;
  endpointUrl: string;
  apiKey: string;
  model: string;
  jsonMode?: boolean;
  allowLoopbackDev?: boolean;
  alwaysRefineWriting?: boolean;
}): RoutedAiCandidate {
  return {
    id: input.id,
    worker: createStructuredAiProvider({
      endpointUrl: input.endpointUrl,
      apiKey: input.apiKey,
      model: input.model,
      costClass: "free_or_included",
      jsonMode: input.jsonMode,
      allowLoopbackDev: input.allowLoopbackDev,
      alwaysRefineWriting: input.alwaysRefineWriting,
    }),
  };
}

function pushUnique(target: RoutedAiCandidate[], item: RoutedAiCandidate | null) {
  if (item && !target.some((candidate) => candidate.id === item.id)) target.push(item);
}

function freeProviderKey(environment: NodeJS.ProcessEnv, scoutKey: string, standardKeys: readonly string[]) {
  const explicit = value(environment, scoutKey);
  if (explicit) return explicit;
  if (value(environment, "SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS") !== "1") return "";
  for (const standardKey of standardKeys) {
    const found = value(environment, standardKey);
    if (found) return found;
  }
  return "";
}

export function createAgentAiProvider(environment: NodeJS.ProcessEnv = process.env) {
  const refineWriting = highQualityMode(environment);
  const explicitFields = ["SCOUT_AI_ENDPOINT_URL", "SCOUT_AI_API_KEY", "SCOUT_AI_MODEL", "SCOUT_AI_COST_CLASS"] as const;
  const explicitCount = explicitFields.filter((name) => value(environment, name)).length;
  if (explicitCount) {
    if (explicitCount !== explicitFields.length) throw new Error("Explicit Scout AI configuration is incomplete");
    const costClass = required("SCOUT_AI_COST_CLASS", environment.SCOUT_AI_COST_CLASS);
    if (costClass !== "free_or_included" && costClass !== "metered") {
      throw new Error("SCOUT_AI_COST_CLASS must be free_or_included or metered");
    }
    const explicit: RoutedAiCandidate = {
      id: `explicit:${required("SCOUT_AI_MODEL", environment.SCOUT_AI_MODEL)}`,
      worker: createStructuredAiProvider({
        endpointUrl: required("SCOUT_AI_ENDPOINT_URL", environment.SCOUT_AI_ENDPOINT_URL),
        apiKey: required("SCOUT_AI_API_KEY", environment.SCOUT_AI_API_KEY),
        model: required("SCOUT_AI_MODEL", environment.SCOUT_AI_MODEL),
        costClass,
        allowMeteredAi: environment.SCOUT_ALLOW_METERED_AI === "1",
        allowLoopbackDev: environment.SCOUT_AI_ALLOW_LOOPBACK_DEV === "1",
        jsonMode: environment.SCOUT_AI_JSON_MODE !== "0",
        alwaysRefineWriting: refineWriting,
      }),
    };
    return createQualityAiRouter({ classification: [explicit], writing: [explicit] });
  }

  const nimKey = freeProviderKey(environment, "SCOUT_NIM_FREE_API_KEY", ["NVIDIA_API_KEY", "NGC_API_KEY"]);
  const groqKey = freeProviderKey(environment, "SCOUT_GROQ_FREE_API_KEY", ["GROQ_API_KEY"]);
  const geminiKey = freeProviderKey(environment, "SCOUT_GEMINI_FREE_API_KEY", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  const cerebrasKey = freeProviderKey(environment, "SCOUT_CEREBRAS_FREE_API_KEY", ["CEREBRAS_API_KEY"]);
  const openrouterKey = freeProviderKey(environment, "SCOUT_OPENROUTER_FREE_API_KEY", ["OPENROUTER_API_KEY"]);
  const ollamaEndpoint = value(environment, "SCOUT_OLLAMA_ENDPOINT_URL");
  const ollamaKey = value(environment, "SCOUT_OLLAMA_API_KEY");
  const ollamaModel = value(environment, "SCOUT_OLLAMA_MODEL");

  const groqFast = groqKey ? candidate({
    id: "groq:qwen3.6-27b",
    endpointUrl: value(environment, "SCOUT_GROQ_ENDPOINT_URL") || GROQ_ENDPOINT,
    apiKey: groqKey,
    model: value(environment, "SCOUT_GROQ_FAST_MODEL") || DEFAULT_MODELS.groqFast,
    jsonMode: true,
    alwaysRefineWriting: refineWriting,
  }) : null;
  const groqReasoning = groqKey ? candidate({
    id: "groq:gpt-oss-120b",
    endpointUrl: value(environment, "SCOUT_GROQ_ENDPOINT_URL") || GROQ_ENDPOINT,
    apiKey: groqKey,
    model: value(environment, "SCOUT_GROQ_REASONING_MODEL") || DEFAULT_MODELS.groqReasoning,
    jsonMode: true,
    alwaysRefineWriting: refineWriting,
  }) : null;

  const nimLightning = nimKey ? candidate({
    id: "nim:nemotron-3.5-lightning",
    endpointUrl: value(environment, "SCOUT_NIM_ENDPOINT_URL") || NIM_ENDPOINT,
    apiKey: nimKey,
    model: value(environment, "SCOUT_NIM_LIGHTNING_MODEL") || DEFAULT_MODELS.nimLightning,
    jsonMode: false,
    alwaysRefineWriting: refineWriting,
  }) : null;
  const nimReasoning = nimKey ? candidate({
    id: "nim:deepseek-v4-flash-0731",
    endpointUrl: value(environment, "SCOUT_NIM_ENDPOINT_URL") || NIM_ENDPOINT,
    apiKey: nimKey,
    model: value(environment, "SCOUT_NIM_REASONING_MODEL") || DEFAULT_MODELS.nimReasoning,
    jsonMode: false,
    alwaysRefineWriting: refineWriting,
  }) : null;
  const nimUltra = nimKey ? candidate({
    id: "nim:nemotron-3-ultra",
    endpointUrl: value(environment, "SCOUT_NIM_ENDPOINT_URL") || NIM_ENDPOINT,
    apiKey: nimKey,
    model: value(environment, "SCOUT_NIM_ULTRA_MODEL") || DEFAULT_MODELS.nimUltra,
    jsonMode: false,
    alwaysRefineWriting: refineWriting,
  }) : null;

  const gemini = geminiKey ? candidate({
    id: "gemini:3.7-flash",
    endpointUrl: value(environment, "SCOUT_GEMINI_ENDPOINT_URL") || GEMINI_ENDPOINT,
    apiKey: geminiKey,
    model: value(environment, "SCOUT_GEMINI_MODEL") || DEFAULT_MODELS.gemini,
    jsonMode: false,
    alwaysRefineWriting: refineWriting,
  }) : null;
  const cerebras = cerebrasKey ? candidate({
    id: "cerebras:gpt-oss-120b",
    endpointUrl: value(environment, "SCOUT_CEREBRAS_ENDPOINT_URL") || CEREBRAS_ENDPOINT,
    apiKey: cerebrasKey,
    model: value(environment, "SCOUT_CEREBRAS_MODEL") || DEFAULT_MODELS.cerebras,
    jsonMode: false,
    alwaysRefineWriting: refineWriting,
  }) : null;
  const openrouter = openrouterKey ? candidate({
    id: "openrouter:free",
    endpointUrl: value(environment, "SCOUT_OPENROUTER_ENDPOINT_URL") || OPENROUTER_ENDPOINT,
    apiKey: openrouterKey,
    model: value(environment, "SCOUT_OPENROUTER_MODEL") || DEFAULT_MODELS.openrouter,
    jsonMode: false,
    alwaysRefineWriting: refineWriting,
  }) : null;
  const ollama = ollamaEndpoint && ollamaKey && ollamaModel ? candidate({
    id: `ollama:${ollamaModel}`,
    endpointUrl: ollamaEndpoint,
    apiKey: ollamaKey,
    model: ollamaModel,
    jsonMode: value(environment, "SCOUT_OLLAMA_JSON_MODE") === "1",
    allowLoopbackDev: true,
    alwaysRefineWriting: refineWriting,
  }) : null;

  const classification: RoutedAiCandidate[] = [];
  for (const item of [nimLightning, nimReasoning, groqReasoning, groqFast, gemini, nimUltra, cerebras, openrouter, ollama]) {
    pushUnique(classification, item);
  }

  const writing: RoutedAiCandidate[] = [];
  for (const item of [nimReasoning, nimUltra, groqReasoning, gemini, nimLightning, cerebras, groqFast, openrouter, ollama]) {
    pushUnique(writing, item);
  }

  if (!classification.length || !writing.length) {
    throw new Error("No Scout AI provider is configured; add a free/included provider key or keep a local Ollama fallback available");
  }

  return createQualityAiRouter({ classification, writing });
}
