const HEX_64 = /^[a-f0-9]{64}$/i;
const TOKEN_WINDOW_MS = 3 * 60_000;

export const BROWSER_HANDOFF_CAPABILITIES = Object.freeze({
  profileDataInToken: false,
  exactUrlBound: true,
  applicationVersionBound: true,
  shortLived: true,
  sendEmail: false,
  submitApplication: false,
} as const);

type BrowserHandoffPayload = {
  v: 1;
  applicationId: string;
  artifactVersion: number;
  allowedUrl: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Browser handoff token is invalid");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  if (!HEX_64.test(value)) throw new Error("SCOUT_BROWSER_HANDOFF_SECRET must be exactly 64 hex characters");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}

async function hmac(secret: string, value: string, usage: "sign" | "verify", signature?: string) {
  const key = await crypto.subtle.importKey("raw", fromHex(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
  if (usage === "sign") return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
  if (!signature || !HEX_64.test(signature)) return false;
  return crypto.subtle.verify("HMAC", key, fromHex(signature), new TextEncoder().encode(value));
}

function cleanApplicationId(value: string) {
  const candidate = value.trim();
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(candidate)) throw new Error("Application id is invalid");
  return candidate;
}

function exactApplicationUrl(value: string) {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new Error("Application URL is invalid");
  return `${url.origin}${url.pathname}`;
}

export async function createBrowserHandoffToken(input: {
  applicationId: string;
  artifactVersion: number;
  allowedUrl: string;
  secret: string;
  now?: number;
  nonce?: string;
}) {
  const now = input.now ?? Date.now();
  if (!Number.isInteger(input.artifactVersion) || input.artifactVersion < 1) throw new Error("Application artifact version is invalid");
  const payload: BrowserHandoffPayload = {
    v: 1,
    applicationId: cleanApplicationId(input.applicationId),
    artifactVersion: input.artifactVersion,
    allowedUrl: exactApplicationUrl(input.allowedUrl),
    issuedAt: now,
    expiresAt: now + TOKEN_WINDOW_MS,
    nonce: (input.nonce ?? crypto.randomUUID()).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 160),
  };
  if (!payload.nonce) throw new Error("Browser handoff nonce is invalid");
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(input.secret, encoded, "sign") as string;
  return { token: `scout1.${encoded}.${signature}`, expiresAt: payload.expiresAt };
}

export async function verifyBrowserHandoffToken(input: {
  token: string;
  secret: string;
  currentUrl: string;
  now?: number;
}) {
  const parts = input.token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "scout1") throw new Error("Browser handoff token is invalid");
  const [, encoded, signature] = parts;
  if (!await hmac(input.secret, encoded, "verify", signature) as boolean) throw new Error("Browser handoff signature is invalid");
  let payload: BrowserHandoffPayload;
  try { payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as BrowserHandoffPayload; }
  catch { throw new Error("Browser handoff payload is invalid"); }
  const now = input.now ?? Date.now();
  if (payload.v !== 1 || !Number.isInteger(payload.issuedAt) || !Number.isInteger(payload.expiresAt) || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > TOKEN_WINDOW_MS) {
    throw new Error("Browser handoff validity window is invalid");
  }
  if (now < payload.issuedAt - 30_000 || now > payload.expiresAt) throw new Error("Browser handoff token is expired");
  const currentUrl = exactApplicationUrl(input.currentUrl);
  if (currentUrl !== payload.allowedUrl) throw new Error("Browser handoff token is pinned to a different application page");
  return {
    applicationId: cleanApplicationId(payload.applicationId),
    artifactVersion: payload.artifactVersion,
    allowedUrl: payload.allowedUrl,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  };
}
