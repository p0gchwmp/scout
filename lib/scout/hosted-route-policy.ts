const PUBLIC_EXACT_PATHS = new Set([
  "/sign-in",
  "/sign-out",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
  "/_next/static",
  "/_next/image",
  "/favicon.svg",
  "/file.svg",
  "/globe.svg",
  "/og.png",
  "/window.svg",
]);

const PUBLIC_PREFIXES = [
  "/sign-in/",
  "/sign-out/",
  "/signin-with-chatgpt/",
  "/signout-with-chatgpt/",
  "/callback/",
  "/_next/static/",
] as const;

export function isHostedPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isHostedOwnerProtectedPath(pathname: string): boolean {
  return !isHostedPublicPath(pathname);
}

export function hostedAuthFailureUsesJson(pathname: string): boolean {
  return pathname === "/health" || pathname === "/api" || pathname.startsWith("/api/");
}
