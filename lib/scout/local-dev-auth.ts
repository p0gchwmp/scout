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

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";

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

  if (environment[LOCAL_DEV_AUTH_FLAG] !== "1") return bindings;

  const localUserId = validConfiguredId(environment[LOCAL_DEV_USER_ID]);
  if (!ownerUserId || !localUserId || ownerUserId !== localUserId) {
    throw new Error(
      "SCOUT_LOCAL_DEV_AUTH=1 requires SCOUT_LOCAL_DEV_USER_ID and " +
        "SCOUT_OWNER_USER_ID to be valid, identical explicit ids.",
    );
  }

  const discoverySecret = environment[LOCAL_DISCOVERY_SECRET]?.trim();
  if (discoverySecret && !/^[a-f0-9]{64}$/i.test(discoverySecret)) {
    throw new Error("SCOUT_LOCAL_DISCOVERY_SECRET must be 64 hex characters when configured.");
  }

  return {
    ...bindings,
    [LOCAL_DEV_RUNTIME]: "1",
    [LOCAL_DEV_AUTH_FLAG]: "1",
    [LOCAL_DEV_USER_ID]: localUserId,
    ...(discoverySecret ? { [LOCAL_DISCOVERY_SECRET]: discoverySecret } : {}),
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
