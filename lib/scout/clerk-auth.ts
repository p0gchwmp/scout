export type VerifiedClerkSession = {
  userId: string;
  sessionId: string | null;
};

type JwtHeader = {
  alg?: unknown;
  typ?: unknown;
};

type JwtPayload = {
  sub?: unknown;
  sid?: unknown;
  iss?: unknown;
  azp?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  sts?: unknown;
  act?: unknown;
};

let cachedPem = "";
let cachedKey: CryptoKey | null = null;

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Invalid Clerk JWT encoding");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJson<T>(value: string): T {
  const text = new TextDecoder().decode(base64UrlBytes(value));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid Clerk JWT JSON");
  }
}

function pemBytes(pem: string) {
  const encoded = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!encoded) throw new Error("CLERK_JWT_KEY is empty");
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error("CLERK_JWT_KEY is not valid PEM");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function verificationKey(pem: string) {
  if (cachedKey && cachedPem === pem) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    "spki",
    pemBytes(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  cachedPem = pem;
  return cachedKey;
}

function exactOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SCOUT_PUBLIC_ORIGIN must be an absolute URL");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SCOUT_PUBLIC_ORIGIN must contain only scheme, host and optional port");
  }
  return url.origin;
}

export function clerkSessionToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, "").trim() || null;
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [rawName, ...parts] = item.trim().split("=");
    if (rawName === "__session") return decodeURIComponent(parts.join("=")) || null;
  }
  return null;
}

export async function verifyClerkSession(
  token: string,
  options: {
    jwtKey: string;
    issuer: string;
    publicOrigin: string;
    nowSeconds?: number;
    clockSkewSeconds?: number;
  },
): Promise<VerifiedClerkSession> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Clerk JWT structure");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson<JwtHeader>(encodedHeader);
  const payload = decodeJson<JwtPayload>(encodedPayload);
  if (header.alg !== "RS256") throw new Error("Unsupported Clerk JWT algorithm");
  if (header.typ !== undefined && header.typ !== "JWT") throw new Error("Unsupported Clerk JWT type");

  const key = await verificationKey(options.jwtKey);
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(encodedSignature),
    signed,
  );
  if (!valid) throw new Error("Clerk JWT signature verification failed");

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 5;
  if (typeof payload.exp !== "number" || payload.exp < now - skew) throw new Error("Clerk session expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + skew) throw new Error("Clerk session is not active yet");
  if (typeof payload.iat === "number" && payload.iat > now + skew) throw new Error("Clerk session issue time is invalid");

  const issuer = options.issuer.trim().replace(/\/$/, "");
  if (!issuer || payload.iss !== issuer) throw new Error("Clerk session issuer mismatch");
  const publicOrigin = exactOrigin(options.publicOrigin);
  if (payload.azp !== publicOrigin) throw new Error("Clerk session authorized party mismatch");
  if (payload.sts === "pending") throw new Error("Clerk session is pending");
  if (payload.act !== undefined) throw new Error("Clerk impersonation sessions are not accepted by Scout");
  if (typeof payload.sub !== "string" || !/^user_[A-Za-z0-9]+$/.test(payload.sub)) {
    throw new Error("Clerk session has no valid user id");
  }

  return {
    userId: payload.sub,
    sessionId: typeof payload.sid === "string" ? payload.sid : null,
  };
}
