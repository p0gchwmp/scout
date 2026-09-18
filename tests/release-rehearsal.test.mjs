import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function runBuiltWorkerRehearsal() {
  const { default: assert } = await import("node:assert/strict");
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");

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

  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: fakeD1(),
    SCOUT_OWNER_USER_ID: "test-user",
    SCOUT_SEARCH_PROVIDER: "disabled",
  };
  globalThis.__SCOUT_RELEASE_REHEARSAL_ENV__ = env;

  const workerUrl = pathToFileURL(resolve("dist/server/index.js"));
  workerUrl.searchParams.set("release-rehearsal", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
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

    const invalidBrowserHandoff = await worker.fetch(new Request("http://localhost/browser-handoff/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: `scout1.${"a".repeat(60)}.${"b".repeat(64)}`,
        currentUrl: "https://example.com/jobs/apply",
        fields: [],
      }),
    }), env, context);
    assert.equal(invalidBrowserHandoff.status, 401);
    assert.deepEqual(await invalidBrowserHandoff.json(), {
      error: "Browser handoff was invalid, expired, or pinned to a different page",
    });

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
    assert.equal(payload.status, "ready");
    assert.equal(payload.core.database.state, "ready");
    assert.equal(payload.core.schema.state, "ready");
    assert.equal(payload.core.immutableEvidence.state, "ready");
    assert.deepEqual(payload.policies, {
      applicationSubmission: false,
      emailSending: false,
      captchaSolving: false,
      privateContactScraping: false,
      searchResultPersistence: "disabled",
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
}

test("production release rehearsal keeps Scout owner-only, zero-network, and non-sending", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "scout-release-rehearsal-"));
  const loaderPath = join(tempDir, "cloudflare-loader.mjs");
  await writeFile(loaderPath, [
    "export async function resolve(specifier, context, nextResolve) {",
    "  if (specifier === 'cloudflare:workers') {",
    "    const code = \"export const env = globalThis.__SCOUT_RELEASE_REHEARSAL_ENV__ ?? {};\";",
    "    return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true };",
    "  }",
    "  return nextResolve(specifier, context);",
    "}",
    "",
  ].join("\n"), "utf8");

  try {
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, [
        "--experimental-loader",
        pathToFileURL(loaderPath).href,
        "--input-type=module",
        "--eval",
        `(${runBuiltWorkerRehearsal.toString()})()`,
      ], {
        cwd: new URL("../", import.meta.url),
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
    });

    assert.equal(
      result.code,
      0,
      `Built-worker rehearsal failed${result.signal ? ` (${result.signal})` : ""}.\n${result.stderr}${result.stdout}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
