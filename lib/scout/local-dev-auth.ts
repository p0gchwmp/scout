export type LocalDevAuthUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export type LocalDevAuthContext = {
  user: LocalDevAuthUser;
  ownerUserId: string;
};

type EnvironmentReader = Record<string, string | undefined>;
type HeaderReader = Pick<Headers, "get">;
type RequestReader = {
  url: string;
  headers: HeaderReader;
};

type WorkerBindingReader = Record<string, unknown>;

const LOCAL_DEV_AUTH_FLAG = "SCOUT_LOCAL_DEV_AUTH";
const LOCAL_DEV_RUNTIME = "SCOUT_LOCAL_DEV_RUNTIME";
const LOCAL_DEV_USER_ID = "SCOUT_LOCAL_DEV_USER_ID";
const SCOUT_OWNER_USER_ID = "SCOUT_OWNER_USER_ID";
const LOCAL_DISCOVERY_SECRET = "SCOUT_LOCAL_DISCOVERY_SECRET";
const BROWSER_HANDOFF_SECRET = "SCOUT_BROWSER_HANDOFF_SECRET";
const AGENT_BASE_URL = "SCOUT_AGENT_BASE_URL";
const AGENT_SHARED_SECRET = "SCOUT_AGENT_SHARED_SECRET";
const AGENT_ALLOW_LOOPBACK_DEV = "SCOUT_AGENT_ALLOW_LOOPBACK_DEV";

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";

function optionalHexSecret(environment: EnvironmentReader, key: string) {
  const value = environment[key]?.trim();
  if (!value) return null;
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${key} must be 64 hex characters when configured.`);
  return value;
}

function optionalAgentBaseUrl(environment: EnvironmentReader) {
  const raw = environment[AGENT_BASE_URL]?.trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("SCOUT_AGENT_BASE_URL is invalid when configured."); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const allowLoopback = environment[AGENT_ALLOW_LOOPBACK_DEV]?.trim() === "1";
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("SCOUT_AGENT_BASE_URL must be an origin only.");
  if (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" && loopback)) throw new Error("SCOUT_AGENT_BASE_URL must use HTTPS outside explicit loopback development.");
  return url.origin;
}

/**
 * Build bindings for Vinext's local Cloudflare worker.
 *
 * The local-auth runtime marker is created only for `vite serve` in
 * development mode. Production builds never receive the marker even if the
 * shell still has SCOUT_LOCAL_DEV_AUTH=1 set.
 */
export function buildLocalDevWorkerBindings(
  command: string,
  mode: string,
  environment: EnvironmentReader = process.env,
): Record<string, string> {
  if (command !== "serve" || mode !== "development") return {};

  const bindings: Record<string, string> = {};
  const ownerUserId = validConfiguredId(environment[SCOUT_OWNER_USER_ID]);
  if (ownerUserId) bindings[SCOUT_OWNER_USER_ID] = ownerUserId;

  const discoverySecret = optionalHexSecret(environment, LOCAL_DISCOVERY_SECRET);
  const browserHandoffSecret = optionalHexSecret(environment, BROWSER_HANDOFF_SECRET);
  const agentSharedSecret = optionalHexSecret(environment, AGENT_SHARED_SECRET);
  const agentBaseUrl = optionalAgentBaseUrl(environment);
  const agentAllowLoopback = environment[AGENT_ALLOW_LOOPBACK_DEV]?.trim() === "1";
  if ((agentBaseUrl && !agentSharedSecret) || (!agentBaseUrl && agentSharedSecret)) {
    throw new Error("SCOUT_AGENT_BASE_URL and SCOUT_AGENT_SHARED_SECRET must be configured together.");
  }
  if (discoverySecret) bindings[LOCAL_DISCOVERY_SECRET] = discoverySecret;
  if (browserHandoffSecret) bindings[BROWSER_HANDOFF_SECRET] = browserHandoffSecret;
  if (agentBaseUrl && agentSharedSecret) {
    bindings[AGENT_BASE_URL] = agentBaseUrl;
    bindings[AGENT_SHARED_SECRET] = agentSharedSecret;
    if (agentAllowLoopback) bindings[AGENT_ALLOW_LOOPBACK_DEV] = "1";
  }

  if (environment[LOCAL_DEV_AUTH_FLAG] !== "1") return bindings;

  const localUserId = validConfiguredId(environment[LOCAL_DEV_USER_ID]);
  if (!ownerUserId || !localUserId || ownerUserId !== localUserId) {
    throw new Error(
      "SCOUT_LOCAL_DEV_AUTH=1 requires SCOUT_LOCAL_DEV_USER_ID and " +
        "SCOUT_OWNER_USER_ID to be valid, identical explicit ids.",
    );
  }

  return {
    ...bindings,
    [LOCAL_DEV_RUNTIME]: "1",
    [LOCAL_DEV_AUTH_FLAG]: "1",
    [LOCAL_DEV_USER_ID]: localUserId,
  };
}

/**
 * Resolve a synthetic owner identity at the outer Worker boundary.
 *
 * This deliberately does not read process.env: Vinext's local Cloudflare
 * runtime receives bindings through the Worker `env` object instead.
 */
export function resolveLocalDevWorkerAuth(
  request: RequestReader,
  bindings: WorkerBindingReader,
): LocalDevAuthContext | null {
  if (stringBinding(bindings[LOCAL_DEV_RUNTIME]) !== "1") return null;
  if (stringBinding(bindings[LOCAL_DEV_AUTH_FLAG]) !== "1") return null;

  // Never mask or replace any hosted identity, including a partial one.
  if (
    request.headers.get(USER_ID_HEADER) ||
    request.headers.get(USER_EMAIL_HEADER) ||
    request.headers.get(USER_FULL_NAME_HEADER) ||
    request.headers.get(USER_FULL_NAME_ENCODING_HEADER)
  ) {
    return null;
  }

  if (!isLoopbackRequest(request)) return null;

  const userId = validConfiguredId(stringBinding(bindings[LOCAL_DEV_USER_ID]));
  const ownerUserId = validConfiguredId(
    stringBinding(bindings[SCOUT_OWNER_USER_ID]),
  );
  if (!userId || !ownerUserId || userId !== ownerUserId) return null;

  const fullName = "Scout Local Owner (development)";
  return {
    ownerUserId,
    user: {
      userId,
      displayName: fullName,
      email: "scout-local-owner@localhost.invalid",
      fullName,
    },
  };
}

function isLoopbackRequest(request: RequestReader): boolean {
  let requestHostname: string;
  try {
    requestHostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!isLoopbackHostname(requestHostname)) return false;

  const host = request.headers.get("host");
  if (host && !isLoopbackHostHeader(host)) return false;

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && !isLoopbackHostHeader(forwardedHost)) return false;

  return true;
}

function isLoopbackHostHeader(value: string): boolean {
  // Host chains are ambiguous; fail closed instead of guessing.
  if (value.includes(",")) return false;

  try {
    return isLoopbackHostname(new URL(`http://${value}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function stringBinding(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validConfiguredId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 256) return null;
  if (/[^\x21-\x7e]/.test(trimmed)) return null;
  return trimmed;
}
