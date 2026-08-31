import assert from "node:assert/strict";
import test from "node:test";

const REQUIRED_TABLES = [
  "company_sources",
  "sync_runs",
  "jobs",
  "job_snapshots",
  "contact_evidence",
  "candidate_claims",
  "outreach_drafts",
  "outreach_draft_revisions",
  "applications",
  "profile_evidence",
];
const REQUIRED_TRIGGERS = [
  "job_snapshots_immutable_update",
  "job_snapshots_immutable_delete",
  "candidate_claims_approved_immutable_update",
  "candidate_claims_approved_immutable_delete",
  "outreach_revisions_immutable_update",
  "outreach_revisions_immutable_delete",
];

function fakeD1() {
  return {
    prepare(query) {
      let values = [];
      const statement = {
        bind(...next) {
          values = next;
          return statement;
        },
        async all() {
          if (/sqlite_master/i.test(query)) {
            const requested = new Set(values.map(String));
            const results = [
              ...REQUIRED_TABLES.filter((name) => requested.has(name)).map((name) => ({ type: "table", name })),
              ...REQUIRED_TRIGGERS.filter((name) => requested.has(name)).map((name) => ({ type: "trigger", name })),
            ];
            return { results, success: true, meta: {} };
          }
          if (/select\s+1\s+as\s+ok/i.test(query)) return { results: [{ ok: 1 }], success: true, meta: {} };
          return { results: [], success: true, meta: {} };
        },
        async raw() { return []; },
        async first() { return null; },
        async run() { return { success: true, meta: {} }; },
      };
      return statement;
    },
  };
}

function ownerHeaders(extra = {}) {
  return {
    accept: "application/json",
    "oai-authenticated-user-id": "test-user",
    "oai-authenticated-user-email": "test@example.com",
    ...extra,
  };
}

test("production release rehearsal keeps Scout owner-only, zero-network, and non-sending", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("release-rehearsal", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: fakeD1(),
    SCOUT_OWNER_USER_ID: "test-user",
    SCOUT_SEARCH_PROVIDER: "disabled",
  };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const originalFetch = globalThis.fetch;
  const externalFetches = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      externalFetches.push(url.href);
      throw new Error(`Release rehearsal blocked external fetch: ${url.origin}`);
    }
    return originalFetch(input, init);
  };

  try {
    const anonymousHealth = await worker.fetch(new Request("http://localhost/api/health"), env, context);
    assert.equal(anonymousHealth.status, 401);

    const nonOwnerHealth = await worker.fetch(new Request("http://localhost/api/health", {
      headers: {
        "oai-authenticated-user-id": "other-user",
        "oai-authenticated-user-email": "other@example.com",
      },
    }), env, context);
    assert.equal(nonOwnerHealth.status, 403);

    const health = await worker.fetch(new Request("http://localhost/api/health", { headers: ownerHeaders() }), env, context);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      database: "ok",
      ownerOnly: true,
      externalSideEffects: { applicationSubmission: false, emailSending: false },
    });

    const readiness = await worker.fetch(new Request("http://localhost/api/runtime-readiness", { headers: ownerHeaders() }), env, context);
    assert.equal(readiness.status, 200);
    assert.equal(readiness.headers.get("cache-control"), "no-store");
    const payload = await readiness.json();
    assert.equal(payload.overall, "ready");
    assert.equal(payload.core.database.state, "ready");
    assert.equal(payload.core.schema.state, "ready");
    assert.equal(payload.core.immutableEvidence.state, "ready");
    assert.deepEqual(payload.policies, {
      applicationSubmission: false,
      emailSending: false,
      captchaSolving: false,
      privateContactScraping: false,
      searchResultPersistence: false,
    });

    const setup = await worker.fetch(new Request("http://localhost/setup", {
      headers: ownerHeaders({ accept: "text/html" }),
    }), env, context);
    assert.equal(setup.status, 200);
    const setupHtml = await setup.text();
    assert.match(setupHtml, /Runtime Preflight/i);
    assert.doesNotMatch(setupHtml, /SCOUT_[A-Z0-9_]+/);

    for (const path of ["/api/claims", "/api/applications"]) {
      const crossOrigin = await worker.fetch(new Request(`http://localhost${path}`, {
        method: "POST",
        headers: ownerHeaders({
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        }),
        body: "{}",
      }), env, context);
      assert.equal(crossOrigin.status, 403, path);
      assert.deepEqual(await crossOrigin.json(), { error: "Cross-origin mutation denied" });
    }

    for (const forbiddenCapability of ["/api/applications/submit", "/api/agent/send-gmail"]) {
      const response = await worker.fetch(new Request(`http://localhost${forbiddenCapability}`, {
        method: "POST",
        headers: ownerHeaders({ "content-type": "application/json" }),
        body: "{}",
      }), env, context);
      assert.equal(response.status, 404, `${forbiddenCapability} must remain absent`);
    }

    assert.deepEqual(externalFetches, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
