import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginScoutApiRequest, normalizeScoutApiResponse } from "../lib/scout/browser-api-response.ts";

const baseUrl = "https://scout.example.test/review";

test("detects only same-origin Scout API requests", () => {
  assert.equal(isSameOriginScoutApiRequest("/api/jobs", baseUrl), true);
  assert.equal(isSameOriginScoutApiRequest("https://scout.example.test/api/jobs", baseUrl), true);
  assert.equal(isSameOriginScoutApiRequest("/review", baseUrl), false);
  assert.equal(isSameOriginScoutApiRequest("https://example.com/api/jobs", baseUrl), false);
});

test("preserves valid JSON API responses", () => {
  const response = Response.json({ ok: true });
  assert.equal(normalizeScoutApiResponse("/api/jobs", response, baseUrl), response);
});

test("converts hosted HTML API failures into JSON without exposing the body", async () => {
  const response = new Response("<html><body>router error</body></html>", {
    status: 503,
    headers: { "content-type": "text/html", "x-request-id": "req-123" },
  });
  const normalized = normalizeScoutApiResponse("/api/agent/run", response, baseUrl);
  assert.equal(normalized.status, 503);
  assert.match(normalized.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(normalized.headers.get("x-request-id"), "req-123");
  const payload = await normalized.json() as { error?: string };
  assert.match(payload.error ?? "", /non-JSON error response \(503\)/);
  assert.doesNotMatch(JSON.stringify(payload), /router error/);
});

test("turns unexpected HTML success responses into a fail-closed 502", async () => {
  const response = new Response("<html>unexpected</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const normalized = normalizeScoutApiResponse("/api/jobs", response, baseUrl);
  assert.equal(normalized.status, 502);
  const payload = await normalized.json() as { error?: string };
  assert.match(payload.error ?? "", /non-JSON error response \(502\)/);
});

test("preserves non-API, cross-origin, and intentional no-content responses", () => {
  const html = new Response("<html>page</html>", { status: 500, headers: { "content-type": "text/html" } });
  assert.equal(normalizeScoutApiResponse("/review", html, baseUrl), html);

  const external = new Response("not-json", { status: 500, headers: { "content-type": "text/plain" } });
  assert.equal(normalizeScoutApiResponse("https://example.com/api/jobs", external, baseUrl), external);

  const noContent = new Response(null, { status: 204 });
  assert.equal(normalizeScoutApiResponse("/api/jobs", noContent, baseUrl), noContent);
});

test("returns explicit auth guidance for non-JSON 401 and 403 API responses", async () => {
  const unauthorized = normalizeScoutApiResponse("/api/jobs", new Response("unauthorized", { status: 401 }), baseUrl);
  const forbidden = normalizeScoutApiResponse("/api/jobs", new Response("forbidden", { status: 403 }), baseUrl);
  const unauthorizedPayload = await unauthorized.json() as { error?: string };
  const forbiddenPayload = await forbidden.json() as { error?: string };
  assert.match(unauthorizedPayload.error ?? "", /sign in again/);
  assert.match(forbiddenPayload.error ?? "", /owner access was denied/);
});
