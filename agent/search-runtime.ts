import { createBraveSearchProvider } from "../lib/scout/brave-search.ts";

function value(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() ?? "";
}

export function createAgentSearchProvider(environment: NodeJS.ProcessEnv = process.env) {
  const provider = value(environment, "SCOUT_SEARCH_PROVIDER").toLowerCase();
  if (!provider || provider === "disabled" || provider === "none") return null;
  if (provider !== "brave") throw new Error("SCOUT_SEARCH_PROVIDER is unsupported");

  const apiKey = value(environment, "SCOUT_SEARCH_API_KEY");
  if (!apiKey) throw new Error("SCOUT_SEARCH_API_KEY is required when web search is enabled");
  const costClass = value(environment, "SCOUT_SEARCH_COST_CLASS");
  if (costClass !== "free_or_included" && costClass !== "metered") {
    throw new Error("SCOUT_SEARCH_COST_CLASS must be free_or_included or metered");
  }

  return createBraveSearchProvider({
    apiKey,
    costClass,
    allowMeteredSearch: value(environment, "SCOUT_ALLOW_METERED_SEARCH") === "1",
    allowResultPersistence: value(environment, "SCOUT_SEARCH_RESULT_PERSISTENCE_ALLOWED") === "1",
  });
}
