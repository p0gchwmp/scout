export type BrowserHandoffBindings = Record<string, unknown>;

export const BROWSER_HANDOFF_RUNTIME_SECRET_ENV = "SCOUT_BROWSER_HANDOFF_RUNTIME_SECRET";
export const BROWSER_HANDOFF_LOCAL_SECRET_ENV = "SCOUT_BROWSER_HANDOFF_SECRET";

const HEX_64 = /^[a-f0-9]{64}$/i;

function value(bindings: BrowserHandoffBindings, key: string) {
  return typeof bindings[key] === "string" ? (bindings[key] as string).trim() : "";
}

export function browserHandoffSecretCandidate(bindings: BrowserHandoffBindings) {
  return value(bindings, BROWSER_HANDOFF_RUNTIME_SECRET_ENV)
    || value(bindings, BROWSER_HANDOFF_LOCAL_SECRET_ENV);
}

export function browserHandoffSecretIsValid(secret: string) {
  return HEX_64.test(secret);
}

export function resolveBrowserHandoffSecret(bindings: BrowserHandoffBindings) {
  const secret = browserHandoffSecretCandidate(bindings);
  if (!browserHandoffSecretIsValid(secret)) {
    throw new Error("Browser handoff runtime is not configured");
  }
  return secret;
}
