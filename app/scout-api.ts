type ScoutUserLoader = () => Promise<unknown | null>;
type ScoutOwnerLoader = () => Promise<unknown>;
type ScoutUser = { userId: string };

export const SCOUT_OWNER_CONFIGURATION_ERROR = "Scout owner is not configured";
export const SCOUT_CROSS_ORIGIN_ERROR = "Cross-origin mutation denied";

async function defaultUserLoader() {
  const { getChatGPTUser } = await import("./chatgpt-auth");
  return getChatGPTUser();
}

async function defaultOwnerLoader() {
  const { getScoutOwnerUserId } = await import("./chatgpt-auth");
  return getScoutOwnerUserId();
}

function userWithId(value: unknown): ScoutUser | null {
  if (!value || typeof value !== "object") return null;
  const userId = (value as { userId?: unknown }).userId;
  return typeof userId === "string" && userId.length > 0 ? { userId } : null;
}

export async function loadScoutOwnerId(
  getOwner: ScoutOwnerLoader = defaultOwnerLoader,
): Promise<string | null> {
  const value = await getOwner();
  if (typeof value !== "string") return null;
  const ownerId = value.trim();
  return ownerId.length > 0 ? ownerId : null;
}

export async function requireScoutApiUser(
  getUser: ScoutUserLoader = defaultUserLoader,
  getOwner: ScoutOwnerLoader = defaultOwnerLoader,
): Promise<Response | null> {
  const user = userWithId(await getUser());
  if (!user) return scoutPublicError("Authentication required", 401);

  const ownerId = await loadScoutOwnerId(getOwner);
  if (!ownerId) return scoutPublicError(SCOUT_OWNER_CONFIGURATION_ERROR, 503);
  if (user.userId !== ownerId) return scoutPublicError("Forbidden", 403);
  return null;
}

export async function requireScoutPageOwner(
  user: ScoutUser,
  getOwner: ScoutOwnerLoader = defaultOwnerLoader,
): Promise<void> {
  const ownerId = await loadScoutOwnerId(getOwner);
  if (!ownerId) throw new Error(SCOUT_OWNER_CONFIGURATION_ERROR);
  if (user.userId === ownerId) return;
  throw new Error("Scout owner access denied");
}

export function requireSameOriginMutation(request: Request): Response | null {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      return scoutPublicError(SCOUT_CROSS_ORIGIN_ERROR, 403);
    }
    if (originUrl.origin !== requestUrl.origin) return scoutPublicError(SCOUT_CROSS_ORIGIN_ERROR, 403);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite.toLowerCase() !== "same-origin") {
    return scoutPublicError(SCOUT_CROSS_ORIGIN_ERROR, 403);
  }
  return null;
}

export function scoutPublicError(error: string, status: number) {
  return Response.json({ error }, { status });
}

export function logScoutError(operation: string, error: unknown) {
  console.error("Scout operation failed", {
    operation,
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

export function scoutServerError(operation: string, error: unknown, message: string) {
  logScoutError(operation, error);
  return scoutPublicError(message, 500);
}
