import { validateAiApplicationAnswers, type AiApplicationAnswerEnvelope } from "./ai-agent.ts";
import { signAgentServiceRequest } from "./agent-service-auth.ts";

const HEX_64 = /^[a-f0-9]{64}$/i;

function stringBinding(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function loopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function agentOrigin(bindings: Record<string, unknown>) {
  const raw = stringBinding(bindings.SCOUT_AGENT_BASE_URL);
  const allowLoopback = stringBinding(bindings.SCOUT_AGENT_ALLOW_LOOPBACK_DEV) === "1";
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Scout cloud agent URL is invalid");
  if (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" && loopback(url.hostname))) throw new Error("Scout cloud agent must use HTTPS");
  return url.origin;
}

export async function draftApplicationAnswersViaAgent(bindings: Record<string, unknown>, envelope: AiApplicationAnswerEnvelope, fetcher: typeof fetch = fetch) {
  const baseUrl = agentOrigin(bindings);
  const secret = stringBinding(bindings.SCOUT_AGENT_SHARED_SECRET);
  if (!HEX_64.test(secret)) throw new Error("Scout cloud agent shared secret is invalid");
  const body = JSON.stringify(envelope);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
  const headers = await signAgentServiceRequest({
    method: "POST",
    pathname: "/v1/draft-application-answers",
    taskId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    operation: "draft_application_answers",
    body,
    secret,
  });
  const response = await fetcher(`${baseUrl}/v1/draft-application-answers`, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Scout application-answer agent failed (${response.status})`);
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new Error("Scout application-answer agent returned non-JSON");
  const payload = await response.json() as Record<string, unknown>;
  if (payload.schemaVersion !== 1 || payload.jobSnapshotId !== envelope.jobSnapshotId) throw new Error("Scout application-answer agent returned mismatched evidence bindings");
  const answers = validateAiApplicationAnswers({ answers: payload.answers }, envelope);
  return {
    model: typeof payload.model === "string" ? payload.model.trim().slice(0, 200) : "",
    answers,
  };
}
