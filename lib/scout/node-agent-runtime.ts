import { createScoutAgentClient } from "./agent-client.ts";

export type ScoutAgentRuntimeBindings = {
  SCOUT_AGENT_BASE_URL?: unknown;
  SCOUT_AGENT_SHARED_SECRET?: unknown;
  SCOUT_AGENT_ALLOW_LOCAL_RUNTIME?: unknown;
};

function stringBinding(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function exactPrivateNodeAgentOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:"
    && url.hostname === "127.0.0.1"
    && Boolean(url.port)
    && url.pathname === "/"
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}

export function createScoutAgentClientFromBindings(bindings: ScoutAgentRuntimeBindings) {
  const baseUrl = stringBinding(bindings.SCOUT_AGENT_BASE_URL);
  const sharedSecret = stringBinding(bindings.SCOUT_AGENT_SHARED_SECRET);
  if (!baseUrl || !sharedSecret) throw new Error("Scout cloud agent is not configured");

  const allowPrivateNodeAgent = stringBinding(bindings.SCOUT_AGENT_ALLOW_LOCAL_RUNTIME) === "1";
  if (allowPrivateNodeAgent && !exactPrivateNodeAgentOrigin(baseUrl)) {
    throw new Error("Scout Node local agent must use an explicit 127.0.0.1 port");
  }

  return createScoutAgentClient({
    baseUrl,
    sharedSecret,
    // The generic client deliberately names this low-level switch as a dev
    // escape hatch. This Node-only adapter narrows it to exact 127.0.0.1 and
    // never exposes the flag to Cloudflare/Sites builds.
    allowLoopbackDev: allowPrivateNodeAgent,
  });
}
