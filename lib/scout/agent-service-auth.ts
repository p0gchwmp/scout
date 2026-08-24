const HEX_64 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9._:-]{3,160}$/;
const MAX_CLOCK_SKEW_MS = 60_000;
const MAX_WINDOW_MS = 10 * 60_000;

export type AgentServiceOperation = "plan_job" | "discover_internships" | "resolve_job" | "research_contacts" | "classify_contacts" | "draft_outreach" | "draft_application_answers" | "create_gmail_draft";

export type AgentServiceAuth = {
  taskId: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
  bodyHash: string;
  operation: AgentServiceOperation;
};

export const AGENT_SERVICE_CAPABILITIES = Object.freeze({
  signedRequests: true,
  bodyHashBinding: true,
  expiryRequired: true,
  idempotencyRequired: true,
  replayGuardRequired: true,
  sendEmail: false,
  submitApplication: false,
} as const);

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(value: string) {
  if (!HEX_64.test(value)) throw new Error("Agent signature is invalid");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}

function cleanId(value: string | null, field: string) {
  const candidate = value?.trim() ?? "";
  if (!SAFE_ID.test(candidate)) throw new Error(`${field} is invalid`);
  return candidate;
}

function cleanIso(value: string | null, field: string) {
  const candidate = value?.trim() ?? "";
  const timestamp = Date.parse(candidate);
  if (!candidate || !Number.isFinite(timestamp)) throw new Error(`${field} is invalid`);
  return { value: new Date(timestamp).toISOString(), timestamp };
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function canonicalRequest(input: {
  method: string;
  pathname: string;
  taskId: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
  operation: AgentServiceOperation;
  bodyHash: string;
}) {
  return [
    "SCOUT_AGENT_V1",
    input.method.toUpperCase(),
    input.pathname,
    input.taskId,
    input.idempotencyKey,
    input.issuedAt,
    input.expiresAt,
    input.operation,
    input.bodyHash,
  ].join("\n");
}

async function importHmacKey(secret: string, usage: KeyUsage[]) {
  if (!HEX_64.test(secret)) throw new Error("SCOUT_AGENT_SHARED_SECRET must be exactly 64 hex characters");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export async function signAgentServiceRequest(input: {
  method: string;
  pathname: string;
  taskId: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
  operation: AgentServiceOperation;
  body: string;
  secret: string;
}) {
  const bodyHash = await sha256(input.body);
  const canonical = canonicalRequest({ ...input, bodyHash });
  const key = await importHmacKey(input.secret, ["sign"]);
  const signature = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical))));
  return {
    "content-type": "application/json",
    "x-scout-agent-task-id": input.taskId,
    "x-scout-agent-idempotency-key": input.idempotencyKey,
    "x-scout-agent-issued-at": input.issuedAt,
    "x-scout-agent-expires-at": input.expiresAt,
    "x-scout-agent-operation": input.operation,
    "x-scout-agent-body-sha256": bodyHash,
    "x-scout-agent-signature": signature,
  };
}

export async function verifyAgentServiceRequest(request: Request, secret: string, now = Date.now()): Promise<{ auth: AgentServiceAuth; body: string }> {
  const taskId = cleanId(request.headers.get("x-scout-agent-task-id"), "Agent task id");
  const idempotencyKey = cleanId(request.headers.get("x-scout-agent-idempotency-key"), "Agent idempotency key");
  const issued = cleanIso(request.headers.get("x-scout-agent-issued-at"), "Agent issued timestamp");
  const expires = cleanIso(request.headers.get("x-scout-agent-expires-at"), "Agent expiry timestamp");
  const operation = request.headers.get("x-scout-agent-operation") as AgentServiceOperation | null;
  if (!operation || !["plan_job", "discover_internships", "resolve_job", "research_contacts", "classify_contacts", "draft_outreach", "draft_application_answers", "create_gmail_draft"].includes(operation)) {
    throw new Error("Agent operation is invalid");
  }
  if (issued.timestamp > now + MAX_CLOCK_SKEW_MS) throw new Error("Agent request was issued in the future");
  if (expires.timestamp < now) throw new Error("Agent request is expired");
  if (expires.timestamp <= issued.timestamp || expires.timestamp - issued.timestamp > MAX_WINDOW_MS) throw new Error("Agent request validity window is invalid");

  const body = await request.text();
  if (body.length > 1_000_000) throw new Error("Agent request body is too large");
  const bodyHash = request.headers.get("x-scout-agent-body-sha256")?.toLowerCase() ?? "";
  if (!HEX_64.test(bodyHash) || await sha256(body) !== bodyHash) throw new Error("Agent request body hash does not match");

  const signature = request.headers.get("x-scout-agent-signature")?.toLowerCase() ?? "";
  if (!HEX_64.test(signature)) throw new Error("Agent signature is invalid");
  const url = new URL(request.url);
  const canonical = canonicalRequest({
    method: request.method,
    pathname: url.pathname,
    taskId,
    idempotencyKey,
    issuedAt: issued.value,
    expiresAt: expires.value,
    operation,
    bodyHash,
  });
  const key = await importHmacKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, bytesFromHex(signature), new TextEncoder().encode(canonical));
  if (!valid) throw new Error("Agent signature verification failed");

  return {
    auth: { taskId, idempotencyKey, issuedAt: issued.value, expiresAt: expires.value, bodyHash, operation },
    body,
  };
}

export class InMemoryAgentReplayGuard {
  #seen = new Map<string, number>();

  accept(auth: AgentServiceAuth, now = Date.now()) {
    for (const [key, expiry] of this.#seen) if (expiry < now) this.#seen.delete(key);
    const replayKey = `${auth.taskId}:${auth.idempotencyKey}`;
    if (this.#seen.has(replayKey)) return false;
    this.#seen.set(replayKey, Date.parse(auth.expiresAt));
    return true;
  }
}
