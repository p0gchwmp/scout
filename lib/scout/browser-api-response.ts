type BrowserFetchInput = string | URL | Request;

function requestUrl(input: BrowserFetchInput, baseUrl: string) {
  try {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    return new URL(raw, baseUrl);
  } catch {
    return null;
  }
}

export function isSameOriginScoutApiRequest(input: BrowserFetchInput, baseUrl: string) {
  const request = requestUrl(input, baseUrl);
  const base = requestUrl(baseUrl, baseUrl);
  if (!request || !base || request.origin !== base.origin) return false;
  return request.pathname === "/api" || request.pathname.startsWith("/api/");
}

function normalizedErrorMessage(status: number) {
  if (status === 401) return "Scout session is no longer authenticated. Reload and sign in again.";
  if (status === 403) return "Scout owner access was denied. Reload and sign in with the configured owner account.";
  if (status >= 500) return `Scout service returned an unexpected non-JSON error response (${status}). Please retry.`;
  return `Scout API returned an unexpected response (${status}).`;
}

export function normalizeScoutApiResponse(
  input: BrowserFetchInput,
  response: Response,
  baseUrl: string,
) {
  if (!isSameOriginScoutApiRequest(input, baseUrl)) return response;

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("json") || response.status === 204) return response;

  const redirectedToSignIn = response.redirected && (() => {
    try {
      return new URL(response.url).pathname.startsWith("/sign-in");
    } catch {
      return false;
    }
  })();

  const status = redirectedToSignIn ? 401 : response.ok ? 502 : response.status || 502;
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  const requestId = response.headers.get("x-request-id");
  if (requestId) headers.set("x-request-id", requestId);

  return new Response(JSON.stringify({ error: normalizedErrorMessage(status) }), {
    status,
    headers,
  });
}
