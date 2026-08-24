import { signAgentServiceRequest } from "./agent-service-auth.ts";

const HEX_64 = /^[a-f0-9]{64}$/i;

export type GmailAgentBindings = {
  SCOUT_AGENT_BASE_URL?: unknown;
  SCOUT_AGENT_SHARED_SECRET?: unknown;
  SCOUT_AGENT_ALLOW_LOOPBACK_DEV?: unknown;
};

function loopback(hostname: string) {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "[::1]";
}

function runtime(bindings: GmailAgentBindings) {
  const base = typeof bindings.SCOUT_AGENT_BASE_URL === "string" ? bindings.SCOUT_AGENT_BASE_URL.trim() : "";
  const secret = typeof bindings.SCOUT_AGENT_SHARED_SECRET === "string" ? bindings.SCOUT_AGENT_SHARED_SECRET.trim() : "";
  if (!base || !HEX_64.test(secret)) throw new Error("Scout cloud agent is not configured for Gmail drafts");
  const url = new URL(base);
  const allowLoopback = bindings.SCOUT_AGENT_ALLOW_LOOPBACK_DEV === "1";
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Scout agent URL must be an origin only");
  if (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" && loopback(url.hostname))) {
    throw new Error("Scout agent must use HTTPS outside explicit loopback development");
  }
  return { baseUrl: url.origin, secret };
}

export async function createGmailDraftThroughAgent(bindings: GmailAgentBindings, input: {
  revisionId: string;
  to: string;
  subject: string;
  body: string;
}, fetcher: typeof fetch = fetch) {
  const { baseUrl, secret } = runtime(bindings);
  const body = JSON.stringify(input);
  const now = new Date();
  const taskId = crypto.randomUUID();
  const idempotencyKey = `gmail-draft:${input.revisionId}`;
  const headers = await signAgentServiceRequest({
    method: "POST",
    pathname: "/v1/create-gmail-draft",
    taskId,
    idempotencyKey,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    operation: "create_gmail_draft",
    body,
    secret,
  });
  const response = await fetcher(`${baseUrl}/v1/create-gmail-draft`, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Scout Gmail draft agent request failed (${response.status})`);
  const payload = await response.json() as Record<string, unknown>;
  const draftId = typeof payload.draftId === "string" ? payload.draftId.trim() : "";
  const messageId = typeof payload.messageId === "string" ? payload.messageId.trim() : "";
  const scoutMessageId = typeof payload.scoutMessageId === "string" ? payload.scoutMessageId.trim() : "";
  if (!draftId || !scoutMessageId) throw new Error("Scout Gmail draft agent returned an invalid result");
  return { draftId, messageId, scoutMessageId, reused: payload.reused === true };
}
