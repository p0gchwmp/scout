import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_SERVICE_CAPABILITIES, InMemoryAgentReplayGuard, signAgentServiceRequest, verifyAgentServiceRequest } from "../lib/scout/agent-service-auth.ts";

const secret = "a".repeat(64);
const issuedAt = "2026-08-24T00:00:00.000Z";
const expiresAt = "2026-08-24T00:05:00.000Z";
const now = Date.parse("2026-08-24T00:01:00.000Z");

async function signedRequest(body = JSON.stringify({ url: "https://jobs.lever.co/acme/123" })) {
  const headers = await signAgentServiceRequest({ method: "POST", pathname: "/v1/plan", taskId: "task-123", idempotencyKey: "idem-123", issuedAt, expiresAt, operation: "plan_job", body, secret });
  return new Request("https://agent.example/v1/plan", { method: "POST", headers, body });
}

test("agent service verifies body-bound signed requests", async () => {
  const result = await verifyAgentServiceRequest(await signedRequest(), secret, now);
  assert.equal(result.auth.taskId, "task-123");
  assert.equal(result.auth.idempotencyKey, "idem-123");
  assert.equal(result.auth.operation, "plan_job");
  assert.match(result.body, /jobs\.lever\.co/);
});

test("agent service rejects body tampering and expired requests", async () => {
  const original = await signedRequest();
  const headers = new Headers(original.headers);
  await assert.rejects(() => verifyAgentServiceRequest(new Request(original.url, { method: "POST", headers, body: "{}" }), secret, now), /body hash/);

  const expiredNow = Date.parse("2026-08-24T00:06:00.000Z");
  const expiredRequest = await signedRequest();
  await assert.rejects(() => verifyAgentServiceRequest(expiredRequest, secret, expiredNow), /expired/);
});

test("agent replay guard accepts first execution and rejects the same task/idempotency pair", async () => {
  const verified = await verifyAgentServiceRequest(await signedRequest(), secret, now);
  const guard = new InMemoryAgentReplayGuard();
  assert.equal(guard.accept(verified.auth, now), true);
  assert.equal(guard.accept(verified.auth, now), false);
});

test("agent service has no send or submit capability", () => {
  assert.equal(AGENT_SERVICE_CAPABILITIES.sendEmail, false);
  assert.equal(AGENT_SERVICE_CAPABILITIES.submitApplication, false);
  assert.equal(AGENT_SERVICE_CAPABILITIES.replayGuardRequired, true);
});
