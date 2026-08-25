import assert from "node:assert/strict";
import test from "node:test";

test("production build requires auth and renders Scout for an authenticated user", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    SCOUT_OWNER_USER_ID: "test-user",
  };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const anonymous = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" }, redirect: "manual" }),
    env,
    context,
  );
  assert.equal(anonymous.status, 307);
  assert.match(anonymous.headers.get("location") ?? "", /^\/signin-with-chatgpt\?/);

  const unconfigured = await worker.fetch(new Request("http://localhost/", {
    headers: {
      accept: "text/html",
      "oai-authenticated-user-id": "test-user",
      "oai-authenticated-user-email": "test@example.com",
    },
  }), { ASSETS: env.ASSETS }, context);
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), { error: "Scout owner is not configured" });

  const nonOwner = await worker.fetch(new Request("http://localhost/", {
    headers: {
      accept: "text/html",
      "oai-authenticated-user-id": "other-user",
      "oai-authenticated-user-email": "other@example.com",
    },
  }), env, context);
  assert.equal(nonOwner.status, 403);

  const apiRequest = (headers = {}) => new Request("http://localhost/api/discover", {
    method: "POST",
    headers: {
      "oai-authenticated-user-id": "test-user",
      "oai-authenticated-user-email": "test@example.com",
      ...headers,
    },
  });
  const ownerApi = await worker.fetch(apiRequest(), env, context);
  assert.equal(ownerApi.status, 410);
  const crossOriginApi = await worker.fetch(apiRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), env, context);
  assert.equal(crossOriginApi.status, 403);
  assert.deepEqual(await crossOriginApi.json(), { error: "Cross-origin mutation denied" });

  const response = await worker.fetch(new Request("http://localhost/", {
    headers: {
      accept: "text/html",
      "oai-authenticated-user-id": "test-user",
      "oai-authenticated-user-email": "test@example.com",
    },
  }), env, context);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Scout/);
  assert.match(html, /Review evidence/);
  assert.match(html, /Decide what moves/);
  assert.match(html, /Private/);
  assert.match(html, /owner only/i);
  assert.match(html, /Inbox/);
  assert.match(html, /Shortlist/);
  assert.match(html, /Readiness/);
  assert.match(html, /Safe Fill/);
  assert.match(html, /does not submit applications or send email/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
