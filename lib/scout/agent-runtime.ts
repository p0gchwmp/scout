import { createScoutAgentClient } from "./agent-client.ts";

export type ScoutAgentRuntimeBindings = {
  SCOUT_AGENT_BASE_URL?: unknown;
  SCOUT_AGENT_SHARED_SECRET?: unknown;
  SCOUT_AGENT_ALLOW_LOOPBACK_DEV?: unknown;
};

function stringBinding(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createScoutAgentClientFromBindings(bindings: ScoutAgentRuntimeBindings) {
  const baseUrl = stringBinding(bindings.SCOUT_AGENT_BASE_URL);
  const sharedSecret = stringBinding(bindings.SCOUT_AGENT_SHARED_SECRET);
  if (!baseUrl || !sharedSecret) throw new Error("Scout cloud agent is not configured");
  return createScoutAgentClient({
    baseUrl,
    sharedSecret,
    allowLoopbackDev: stringBinding(bindings.SCOUT_AGENT_ALLOW_LOOPBACK_DEV) === "1",
  });
}
