import { NextResponse, type NextRequest } from "next/server";
import { clerkSessionToken, verifyClerkSession } from "./lib/scout/clerk-auth";

const OWNER_PAGE_PATHS = new Set([
  "/", "/inbox", "/assist", "/voice", "/review", "/shortlist", "/readiness",
  "/applications", "/sources", "/setup", "/evidence", "/preferences", "/quality", "/roles",
]);

function ownerProtected(pathname: string) {
  return OWNER_PAGE_PATHS.has(pathname)
    || pathname.startsWith("/roles/")
    || pathname.startsWith("/api/")
    || pathname === "/health";
}

function signInRedirect(request: NextRequest) {
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("return_to", returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
  return NextResponse.redirect(url, 307);
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function proxy(request: NextRequest) {
  if (process.env.SCOUT_AUTH_PROVIDER?.trim().toLowerCase() !== "clerk") {
    return NextResponse.next();
  }

  if (!ownerProtected(request.nextUrl.pathname)) return NextResponse.next();

  const ownerId = process.env.SCOUT_OWNER_USER_ID?.trim();
  if (!ownerId) return jsonError("Scout owner is not configured", 503);

  const token = clerkSessionToken(request);
  if (!token) {
    return request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname === "/health"
      ? jsonError("Authentication required", 401)
      : signInRedirect(request);
  }

  const jwtKey = process.env.CLERK_JWT_KEY?.trim();
  const issuer = process.env.CLERK_ISSUER?.trim();
  const publicOrigin = process.env.SCOUT_PUBLIC_ORIGIN?.trim();
  if (!jwtKey || !issuer || !publicOrigin) return jsonError("Scout authentication is not configured", 503);

  let session;
  try {
    session = await verifyClerkSession(token, { jwtKey, issuer, publicOrigin });
  } catch {
    return request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname === "/health"
      ? jsonError("Authentication required", 401)
      : signInRedirect(request);
  }

  if (session.userId !== ownerId) return jsonError("Forbidden", 403);

  const headers = new Headers(request.headers);
  // Never trust identity headers supplied by an Internet client. Rebuild the
  // internal Scout identity only after Clerk cryptographic verification.
  headers.delete("oai-authenticated-user-id");
  headers.delete("oai-authenticated-user-email");
  headers.delete("oai-authenticated-user-full-name");
  headers.delete("oai-authenticated-user-full-name-encoding");
  headers.delete("x-scout-owner-user-id");
  headers.set("oai-authenticated-user-id", session.userId);
  headers.set("x-scout-owner-user-id", ownerId);
  headers.set("x-scout-auth-provider", "clerk");

  return NextResponse.next({ request: { headers } });
}

export default proxy;

// Keep the matcher syntax deliberately simple for Vinext's middleware parser.
// The proxy may be invoked for non-Scout/static paths, but ownerProtected()
// remains the authorization boundary and immediately passes those requests on.
export const config = {
  matcher: ["/:path*"],
};
