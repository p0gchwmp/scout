import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const OUTPUT_FILE = resolve(process.cwd(), ".env.scout-gmail.local");
const TIMEOUT_MS = 5 * 60_000;

function required(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value || /[\r\n\0]/.test(value)) throw new Error(`${name} is required and must be supplied through the environment`);
  return value;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function html(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Scout Gmail authorization</title></head><body style="font-family:system-ui;padding:40px;max-width:700px"><h1>Scout Gmail authorization</h1><p>${message}</p><p>You can close this tab and return to PowerShell.</p></body></html>`;
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed (${response.status})`);
  const payload = await response.json();
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
  if (!refreshToken) {
    throw new Error("Google returned no refresh token. Revoke the prior test grant if necessary, then rerun with consent enabled.");
  }
  const grantedScope = typeof payload.scope === "string" ? payload.scope.trim() : "";
  if (grantedScope && !grantedScope.split(/\s+/).includes(GMAIL_COMPOSE_SCOPE)) throw new Error("Google did not grant the Gmail compose scope");
  return refreshToken;
}

async function writeLocalSecrets({ clientId, clientSecret, refreshToken }) {
  const contents = [
    "# Local Scout Gmail OAuth credentials. This file is covered by .gitignore (.env*).",
    "# gmail.compose can technically send mail; Scout code implements drafts.create only.",
    `SCOUT_GMAIL_CLIENT_ID=${JSON.stringify(clientId)}`,
    `SCOUT_GMAIL_CLIENT_SECRET=${JSON.stringify(clientSecret)}`,
    `SCOUT_GMAIL_REFRESH_TOKEN=${JSON.stringify(refreshToken)}`,
    `SCOUT_GMAIL_SCOPE=${JSON.stringify(GMAIL_COMPOSE_SCOPE)}`,
    "",
  ].join("\n");
  await writeFile(OUTPUT_FILE, contents, { encoding: "utf8", mode: 0o600 });
  try { await chmod(OUTPUT_FILE, 0o600); } catch { /* Windows ACLs are managed by the OS; never relax permissions here. */ }
}

const clientId = required("SCOUT_GMAIL_CLIENT_ID");
const clientSecret = required("SCOUT_GMAIL_CLIENT_SECRET");
const state = randomUUID();
const codeVerifier = base64Url(randomBytes(64)).slice(0, 96);
const codeChallenge = base64Url(createHash("sha256").update(codeVerifier, "ascii").digest());

let resolveFlow;
let rejectFlow;
const flow = new Promise((resolvePromise, rejectPromise) => {
  resolveFlow = resolvePromise;
  rejectFlow = rejectPromise;
});

const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== "/oauth2/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    if (url.searchParams.get("state") !== state) throw new Error("OAuth state mismatch");
    const oauthError = url.searchParams.get("error");
    if (oauthError) throw new Error(`Google authorization was not completed (${oauthError})`);
    const code = url.searchParams.get("code")?.trim() ?? "";
    if (!code) throw new Error("Google callback did not include an authorization code");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html("Authorization received. Scout is exchanging the one-time code locally."));
    resolveFlow(code);
  } catch (error) {
    response.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html("Authorization was rejected. Return to PowerShell for the error."));
    rejectFlow(error);
  }
});

server.listen(0, "127.0.0.1");
await new Promise((resolvePromise, rejectPromise) => {
  server.once("listening", resolvePromise);
  server.once("error", rejectPromise);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to allocate the local OAuth callback port");
const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
const authUrl = new URL(AUTH_ENDPOINT);
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", GMAIL_COMPOSE_SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("code_challenge", codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");

console.log("\nScout Gmail OAuth bootstrap (DRAFT CREATION ONLY in Scout code)\n");
console.log("1. Open this Google authorization URL in your normal browser:");
console.log(authUrl.href);
console.log("\n2. Approve only the requested Gmail compose permission for the Google account whose Drafts Scout should use.");
console.log("3. Google will return to a 127.0.0.1 callback handled by this process.\n");
console.log("Scout will NOT print the refresh token and will NOT create or send any email during this bootstrap.\n");

const timer = setTimeout(() => rejectFlow(new Error("Gmail OAuth bootstrap timed out before authorization completed")), TIMEOUT_MS);
try {
  const code = await flow;
  const refreshToken = await exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier });
  await writeLocalSecrets({ clientId, clientSecret, refreshToken });
  console.log(`Gmail OAuth bootstrap complete. Credentials were written to ${OUTPUT_FILE}.`);
  console.log("No Gmail draft or message was created. Move these values into your hosting provider's secret store before deploying the agent.");
} finally {
  clearTimeout(timer);
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
