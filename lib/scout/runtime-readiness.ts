export type RuntimeReadinessState =
  | "ready" | "disabled" | "attention" | "blocked" | "incomplete"
  | "invalid" | "unavailable" | "unverified" | "local_only";

export type RuntimeReadinessItem = {
  state: RuntimeReadinessState;
  configured: boolean;
  required: boolean;
  detail: string;
  provider?: string;
  costClass?: "free_or_included" | "metered";
};

export type RuntimeCoreReadiness = {
  database: RuntimeReadinessItem;
  schema: RuntimeReadinessItem & { missing?: string[] };
  immutableEvidence: RuntimeReadinessItem & { missing?: string[] };
};

export type RuntimeBindings = Record<string, unknown>;

const HEX_64 = /^[a-f0-9]{64}$/i;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const EXPLICIT_AI = ["SCOUT_AI_ENDPOINT_URL", "SCOUT_AI_API_KEY", "SCOUT_AI_MODEL", "SCOUT_AI_COST_CLASS"] as const;

function value(bindings: RuntimeBindings, key: string) {
  return typeof bindings[key] === "string" ? (bindings[key] as string).trim() : "";
}

function validSecret(raw: string, min = 8) {
  return raw.length >= min && !/[\r\n\0]/.test(raw);
}

function validEndpoint(raw: string, allowLoopback: boolean, originOnly = false) {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  const loopback = LOOPBACK.has(url.hostname.toLowerCase());
  if (url.username || url.password || url.hash) return false;
  if (originOnly && (url.search || url.pathname !== "/")) return false;
  if (url.protocol === "https:" && (!loopback || allowLoopback)) return true;
  return Boolean(allowLoopback && loopback && url.protocol === "http:");
}

function exactPrivateNodeLoopback(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  return url.protocol === "http:"
    && url.hostname === "127.0.0.1"
    && Boolean(url.port)
    && url.pathname === "/"
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}

function searchReadiness(bindings: RuntimeBindings) {
  const provider = value(bindings, "SCOUT_SEARCH_PROVIDER").toLowerCase();
  const persistence = value(bindings, "SCOUT_SEARCH_RESULT_PERSISTENCE_ALLOWED") === "1" ? "enabled" as const : "disabled" as const;
  if (!provider || provider === "disabled" || provider === "none") return {
    state: "disabled" as const, configured: false, required: false,
    detail: "Optional web search is disabled. Controlled ATS discovery remains separate.", resultPersistence: persistence,
  };
  if (!["brave", "tavily"].includes(provider)) return {
    state: "invalid" as const, configured: true, required: false,
    detail: "Search provider is unsupported.", resultPersistence: persistence,
  };
  const key = value(bindings, "SCOUT_SEARCH_API_KEY");
  const costClass = value(bindings, "SCOUT_SEARCH_COST_CLASS");
  if (!key || !costClass) return {
    state: "incomplete" as const, configured: true, required: false, provider,
    detail: "Search is enabled but required configuration is incomplete.", resultPersistence: persistence,
  };
  if (!validSecret(key) || !["free_or_included", "metered"].includes(costClass)) return {
    state: "invalid" as const, configured: true, required: false, provider,
    detail: "Search key or cost-class configuration is invalid.", resultPersistence: persistence,
  };
  if (costClass === "metered" && value(bindings, "SCOUT_ALLOW_METERED_SEARCH") !== "1") return {
    state: "blocked" as const, configured: true, required: false, provider, costClass: "metered" as const,
    detail: "Metered search is configured but not explicitly allowed.", resultPersistence: persistence,
  };
  return {
    state: "ready" as const, configured: true, required: false, provider,
    costClass: costClass as "free_or_included" | "metered",
    detail: costClass === "metered" ? "Metered search is explicitly allowed." : "Free/included search configuration is ready.",
    resultPersistence: persistence,
  };
}

function configuredProviderKey(bindings: RuntimeBindings, scoutKey: string, standardKeys: string[]) {
  const direct = value(bindings, scoutKey);
  if (direct) return direct;
  if (value(bindings, "SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS") !== "1") return "";
  return standardKeys.map((key) => value(bindings, key)).find(Boolean) ?? "";
}

function aiReadiness(bindings: RuntimeBindings): RuntimeReadinessItem {
  const explicitCount = EXPLICIT_AI.filter((key) => value(bindings, key)).length;
  if (explicitCount) {
    if (explicitCount !== EXPLICIT_AI.length) return { state: "incomplete", configured: true, required: false, provider: "explicit", detail: "Explicit AI configuration is incomplete." };
    const endpoint = value(bindings, "SCOUT_AI_ENDPOINT_URL");
    const key = value(bindings, "SCOUT_AI_API_KEY");
    const model = value(bindings, "SCOUT_AI_MODEL");
    const costClass = value(bindings, "SCOUT_AI_COST_CLASS");
    if (!validEndpoint(endpoint, value(bindings, "SCOUT_AI_ALLOW_LOOPBACK_DEV") === "1") || !validSecret(key) || !validSecret(model, 2) || !["free_or_included", "metered"].includes(costClass)) {
      return { state: "invalid", configured: true, required: false, provider: "explicit", detail: "Explicit AI endpoint, key, model, or cost class is invalid." };
    }
    if (costClass === "metered" && value(bindings, "SCOUT_ALLOW_METERED_AI") !== "1") return {
      state: "blocked", configured: true, required: false, provider: "explicit", costClass: "metered", detail: "Metered AI is configured but not explicitly allowed.",
    };
    return { state: "ready", configured: true, required: false, provider: "explicit", costClass: costClass as "free_or_included" | "metered", detail: "Explicit AI configuration is ready." };
  }

  const providers: string[] = [];
  const invalid: string[] = [];
  const free = [
    ["nim", "SCOUT_NIM_FREE_API_KEY", ["NVIDIA_API_KEY", "NGC_API_KEY"], "SCOUT_NIM_ENDPOINT_URL"],
    ["groq", "SCOUT_GROQ_FREE_API_KEY", ["GROQ_API_KEY"], "SCOUT_GROQ_ENDPOINT_URL"],
    ["gemini", "SCOUT_GEMINI_FREE_API_KEY", ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "SCOUT_GEMINI_ENDPOINT_URL"],
    ["cerebras", "SCOUT_CEREBRAS_FREE_API_KEY", ["CEREBRAS_API_KEY"], "SCOUT_CEREBRAS_ENDPOINT_URL"],
    ["openrouter", "SCOUT_OPENROUTER_FREE_API_KEY", ["OPENROUTER_API_KEY"], "SCOUT_OPENROUTER_ENDPOINT_URL"],
  ] as const;
  for (const [name, scoutKey, standardKeys, endpointKey] of free) {
    const key = configuredProviderKey(bindings, scoutKey, [...standardKeys]);
    if (!key) continue;
    const endpoint = value(bindings, endpointKey);
    if (!validSecret(key) || (endpoint && !validEndpoint(endpoint, false))) invalid.push(name); else providers.push(name);
  }

  const incomplete: string[] = [];
  for (const prefix of ["POE", "OMNIROUTE"] as const) {
    if (value(bindings, `SCOUT_${prefix}_INCLUDED_ONLY`) !== "1") continue;
    const key = value(bindings, `SCOUT_${prefix}_INCLUDED_API_KEY`);
    const model = value(bindings, `SCOUT_${prefix}_MODEL`);
    const endpoint = prefix === "POE" ? value(bindings, "SCOUT_POE_ENDPOINT_URL") || "https://api.poe.com/v1/chat/completions" : value(bindings, "SCOUT_OMNIROUTE_ENDPOINT_URL");
    const allowLoopback = prefix === "OMNIROUTE" && value(bindings, "SCOUT_OMNIROUTE_ALLOW_LOOPBACK_DEV") === "1";
    if (!key || !model || !endpoint) incomplete.push(prefix.toLowerCase());
    else if (!validSecret(key) || !validSecret(model, 2) || !validEndpoint(endpoint, allowLoopback)) invalid.push(prefix.toLowerCase());
    else providers.push(prefix.toLowerCase());
  }

  const ollama = [value(bindings, "SCOUT_OLLAMA_ENDPOINT_URL"), value(bindings, "SCOUT_OLLAMA_API_KEY"), value(bindings, "SCOUT_OLLAMA_MODEL")];
  if (ollama.some(Boolean)) {
    if (!ollama.every(Boolean)) incomplete.push("ollama");
    else if (!validEndpoint(ollama[0], true) || !validSecret(ollama[1]) || !validSecret(ollama[2], 2)) invalid.push("ollama");
    else providers.push("ollama");
  }
  if (invalid.length) return { state: "invalid", configured: true, required: false, provider: [...providers, ...invalid].join(","), detail: `AI provider configuration is invalid for: ${invalid.join(", ")}.` };
  if (incomplete.length) return { state: "incomplete", configured: true, required: false, provider: [...providers, ...incomplete].join(","), detail: `AI provider configuration is incomplete for: ${incomplete.join(", ")}.` };
  if (!providers.length) return { state: "disabled", configured: false, required: false, detail: "AI routing is optional and no free/included or local provider is configured." };
  return { state: "ready", configured: true, required: false, provider: providers.join(","), costClass: "free_or_included", detail: "Free/included or local AI routing is configured." };
}

function agentReadiness(bindings: RuntimeBindings): RuntimeReadinessItem {
  const base = value(bindings, "SCOUT_AGENT_BASE_URL");
  const secret = value(bindings, "SCOUT_AGENT_SHARED_SECRET");
  if (!base && !secret) return { state: "disabled", configured: false, required: false, detail: "Cloud agent is optional and not configured." };
  if (!base || !secret) return { state: "incomplete", configured: true, required: false, detail: "Cloud agent configuration is incomplete." };
  const allowLoopbackDev = value(bindings, "SCOUT_AGENT_ALLOW_LOOPBACK_DEV") === "1";
  const allowLocalRuntime = value(bindings, "SCOUT_AGENT_ALLOW_LOCAL_RUNTIME") === "1";
  const endpointValid = allowLocalRuntime
    ? exactPrivateNodeLoopback(base)
    : validEndpoint(base, allowLoopbackDev, true);
  if (!HEX_64.test(secret) || !endpointValid) return { state: "invalid", configured: true, required: false, detail: "Cloud agent URL or shared-secret format is invalid." };
  return { state: "ready", configured: true, required: false, detail: "Cloud agent handoff is configured." };
}

function browserReadiness(bindings: RuntimeBindings): RuntimeReadinessItem {
  const secret = value(bindings, "SCOUT_BROWSER_HANDOFF_SECRET");
  if (!secret) return { state: "disabled", configured: false, required: false, detail: "Browser Safe Fill handoff is unavailable until its secret is configured." };
  if (!HEX_64.test(secret)) return { state: "invalid", configured: true, required: false, detail: "Browser handoff secret format is invalid." };
  return { state: "ready", configured: true, required: false, detail: "Short-lived exact-URL browser handoff is configured." };
}

function attention(item: RuntimeReadinessItem) {
  return ["blocked", "incomplete", "invalid", "unavailable"].includes(item.state);
}

export function buildRuntimeReadiness(bindings: RuntimeBindings, core: RuntimeCoreReadiness) {
  const search = searchReadiness(bindings);
  const ai = aiReadiness(bindings);
  const cloudAgent = agentReadiness(bindings);
  const browserHandoff = browserReadiness(bindings);
  const gmailDraft: RuntimeReadinessItem = cloudAgent.state === "ready"
    ? { state: "unverified", configured: true, required: false, detail: "Gmail draft handoff is configured through the agent; remote Gmail OAuth is intentionally not probed by this zero-network check." }
    : { state: "unavailable", configured: false, required: false, detail: "Gmail draft creation is unavailable until the cloud-agent handoff is ready. Email sending remains unavailable." };
  const coreBlocked = [core.database, core.schema, core.immutableEvidence].some((item) => item.state !== "ready");
  const optionalAttention = [search, ai, cloudAgent, browserHandoff].some(attention);
  return {
    status: coreBlocked ? "blocked" as const : optionalAttention ? "attention" as const : "ready" as const,
    ownerOnly: true as const,
    zeroNetwork: true as const,
    core: {
      ownerGate: { state: "ready" as const, configured: true, required: true, detail: "Authenticated request passed Scout owner authorization." },
      ...core,
    },
    capabilities: { search, ai, cloudAgent, browserHandoff, gmailDraft },
    policies: {
      searchResultPersistence: search.resultPersistence,
      applicationSubmission: false as const,
      emailSending: false as const,
      captchaSolving: false as const,
      privateContactScraping: false as const,
    },
    demo: {
      state: "local_only" as const,
      available: true as const,
      productionExecutionProhibited: true as const,
      commands: ["npm run scout:demo:status", "npm run scout:demo:seed", "npm run scout:demo:reset"],
    },
  };
}
