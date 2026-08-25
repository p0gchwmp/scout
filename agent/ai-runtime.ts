import { createStructuredAiProvider } from "../lib/scout/ai-provider.ts";

function required(name: string, value: string | undefined) {
  const candidate = value?.trim() ?? "";
  if (!candidate) throw new Error(`${name} is required for Scout AI tasks`);
  return candidate;
}

export function createAgentAiProvider(environment: NodeJS.ProcessEnv = process.env) {
  const costClass = required("SCOUT_AI_COST_CLASS", environment.SCOUT_AI_COST_CLASS);
  if (costClass !== "free_or_included" && costClass !== "metered") {
    throw new Error("SCOUT_AI_COST_CLASS must be free_or_included or metered");
  }
  return createStructuredAiProvider({
    endpointUrl: required("SCOUT_AI_ENDPOINT_URL", environment.SCOUT_AI_ENDPOINT_URL),
    apiKey: required("SCOUT_AI_API_KEY", environment.SCOUT_AI_API_KEY),
    model: required("SCOUT_AI_MODEL", environment.SCOUT_AI_MODEL),
    costClass,
    allowMeteredAi: environment.SCOUT_ALLOW_METERED_AI === "1",
    allowLoopbackDev: environment.SCOUT_AI_ALLOW_LOOPBACK_DEV === "1",
    jsonMode: environment.SCOUT_AI_JSON_MODE !== "0",
  });
}
