import assert from "node:assert/strict";
import test from "node:test";
import { requireSameOriginMutation } from "../app/scout-api.ts";

const originalPublicOrigin = process.env.SCOUT_PUBLIC_ORIGIN;

function restorePublicOrigin() {
  if (originalPublicOrigin === undefined) delete process.env.SCOUT_PUBLIC_ORIGIN;
  else process.env.SCOUT_PUBLIC_ORIGIN = originalPublicOrigin;
}

test("hosted mutations trust only the configured canonical public origin", async () => {
  try {
    process.env.SCOUT_PUBLIC_ORIGIN = "https://scout.example";

    const hosted = requireSameOriginMutation(new Request("http://0.0.0.0:43210/api/agent/run", {
      method: "POST",
      headers: { origin: "https://scout.example", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(hosted, null);

    for (const headers of [
      { origin: "https://evil.example", "sec-fetch-site": "same-origin" },
      { origin: "not-an-origin", "sec-fetch-site": "same-origin" },
      { origin: "https://scout.example", "sec-fetch-site": "cross-site" },
      { origin: "https://scout.example", "sec-fetch-site": "same-site" },
    ]) {
      const denial = requireSameOriginMutation(new Request("http://0.0.0.0:43210/api/agent/run", {
        method: "POST",
        headers,
      }));
      assert.equal(denial?.status, 403);
      assert.deepEqual(await denial?.json(), { error: "Cross-origin mutation denied" });
    }

    process.env.SCOUT_PUBLIC_ORIGIN = "https://scout.example/not-an-origin-only-value";
    const invalidConfig = requireSameOriginMutation(new Request("http://0.0.0.0:43210/api/agent/run", {
      method: "POST",
      headers: { origin: "https://scout.example", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(invalidConfig?.status, 403);

    delete process.env.SCOUT_PUBLIC_ORIGIN;
    assert.equal(requireSameOriginMutation(new Request("https://local.example/api/jobs", {
      method: "PATCH",
      headers: { origin: "https://local.example", "sec-fetch-site": "same-origin" },
    })), null);

    const localMismatch = requireSameOriginMutation(new Request("https://local.example/api/jobs", {
      method: "PATCH",
      headers: { origin: "https://other.example", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(localMismatch?.status, 403);
  } finally {
    restorePublicOrigin();
  }
});
