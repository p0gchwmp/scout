import assert from "node:assert/strict";
import test from "node:test";
import { RemoteD1Database, remoteD1ConfigFromEnv } from "../db/remote-d1.ts";

const originalFetch = globalThis.fetch;
const savedEnv = {
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  SCOUT_D1_DATABASE_ID: process.env.SCOUT_D1_DATABASE_ID,
  SCOUT_D1_API_TOKEN: process.env.SCOUT_D1_API_TOKEN,
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("remote D1 config fails closed when credentials are missing", () => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.SCOUT_D1_DATABASE_ID;
  delete process.env.SCOUT_D1_API_TOKEN;
  assert.throws(() => remoteD1ConfigFromEnv(), /CLOUDFLARE_ACCOUNT_ID/);
});

test("remote D1 maps prepared query results and keeps token in authorization only", async () => {
  let observedUrl = "";
  let observedAuthorization = "";
  let observedBody: unknown;
  globalThis.fetch = (async (input, init) => {
    observedUrl = String(input);
    observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    observedBody = JSON.parse(String(init?.body));
    return Response.json({
      success: true,
      result: [{ success: true, meta: { changes: 0 }, results: [{ id: "job-1", score: 91 }] }],
    });
  }) as typeof fetch;

  const db = new RemoteD1Database({ accountId: "acct", databaseId: "db-id", apiToken: "secret-token" });
  const result = await db.prepare("SELECT * FROM jobs WHERE enabled = ? AND score >= ?").bind(true, 80).all();
  assert.deepEqual(result.results, [{ id: "job-1", score: 91 }]);
  assert.match(observedUrl, /accounts\/acct\/d1\/database\/db-id\/query$/);
  assert.equal(observedAuthorization, "Bearer secret-token");
  assert.deepEqual(observedBody, { sql: "SELECT * FROM jobs WHERE enabled = ? AND score >= ?", params: [1, 80] });
  assert.doesNotMatch(observedUrl, /secret-token/);
});

test("remote D1 raw maps column-oriented D1 values", async () => {
  globalThis.fetch = (async () => Response.json({
    success: true,
    result: [{ success: true, meta: {}, results: { columns: ["id", "score"], rows: [["job-1", 91]] } }],
  })) as typeof fetch;
  const db = new RemoteD1Database({ accountId: "acct", databaseId: "db-id", apiToken: "token" });
  const rows = await db.prepare("SELECT id, score FROM jobs").raw();
  assert.deepEqual(rows, [["job-1", 91]]);
});

test("remote D1 sends prepared statements through the batch endpoint shape", async () => {
  let observedBody: unknown;
  globalThis.fetch = (async (_input, init) => {
    observedBody = JSON.parse(String(init?.body));
    return Response.json({
      success: true,
      result: [
        { success: true, meta: { changes: 1 }, results: [] },
        { success: true, meta: { changes: 0 }, results: [{ id: "job-1" }] },
      ],
    });
  }) as typeof fetch;
  const db = new RemoteD1Database({ accountId: "acct", databaseId: "db-id", apiToken: "token" });
  const results = await db.batch([
    db.prepare("UPDATE jobs SET score = ? WHERE id = ?").bind(95, "job-1"),
    db.prepare("SELECT id FROM jobs WHERE id = ?").bind("job-1"),
  ]);
  assert.equal(results.length, 2);
  assert.deepEqual(observedBody, {
    batch: [
      { sql: "UPDATE jobs SET score = ? WHERE id = ?", params: [95, "job-1"] },
      { sql: "SELECT id FROM jobs WHERE id = ?", params: ["job-1"] },
    ],
  });
});

test("remote D1 refuses unsupported bound objects", async () => {
  const db = new RemoteD1Database({ accountId: "acct", databaseId: "db-id", apiToken: "token" });
  await assert.rejects(
    db.prepare("SELECT ?").bind({ unsafe: true }).all(),
    /cannot bind parameter type object/,
  );
});
