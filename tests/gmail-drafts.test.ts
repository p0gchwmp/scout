import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildScoutGmailMessage, createOrReuseGmailDraft, GMAIL_DRAFT_CAPABILITIES } from "../agent/gmail-drafts.ts";

const originalEnv = {
  id: process.env.SCOUT_GMAIL_CLIENT_ID,
  secret: process.env.SCOUT_GMAIL_CLIENT_SECRET,
  refresh: process.env.SCOUT_GMAIL_REFRESH_TOKEN,
};

test.after(() => {
  if (originalEnv.id === undefined) delete process.env.SCOUT_GMAIL_CLIENT_ID; else process.env.SCOUT_GMAIL_CLIENT_ID = originalEnv.id;
  if (originalEnv.secret === undefined) delete process.env.SCOUT_GMAIL_CLIENT_SECRET; else process.env.SCOUT_GMAIL_CLIENT_SECRET = originalEnv.secret;
  if (originalEnv.refresh === undefined) delete process.env.SCOUT_GMAIL_REFRESH_TOKEN; else process.env.SCOUT_GMAIL_REFRESH_TOKEN = originalEnv.refresh;
});

test("Gmail adapter builds a pinned draft-only MIME message", () => {
  assert.equal(GMAIL_DRAFT_CAPABILITIES.createDraft, true);
  assert.equal(GMAIL_DRAFT_CAPABILITIES.sendDraft, false);
  assert.equal(GMAIL_DRAFT_CAPABILITIES.sendMessage, false);
  const built = buildScoutGmailMessage({
    revisionId: "revision-123",
    to: "careers@example.com",
    subject: "Product internship — Ryan",
    body: "Hello recruiting team,\n\nThanks.",
  });
  const decoded = Buffer.from(built.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(decoded, /To: careers@example\.com/);
  assert.match(decoded, /Message-ID: <scout-revision-123@drafts\.scout\.invalid>/);
  assert.match(decoded, /Hello recruiting team/);
  assert.throws(() => buildScoutGmailMessage({ revisionId: "revision-1", to: "careers@example.com\nBcc: bad@example.com", subject: "Hi", body: "Body" }), /Recipient is invalid/);
});

test("Gmail retries reuse the deterministic Message-ID instead of creating duplicates", async () => {
  process.env.SCOUT_GMAIL_CLIENT_ID = "client";
  process.env.SCOUT_GMAIL_CLIENT_SECRET = "secret";
  process.env.SCOUT_GMAIL_REFRESH_TOKEN = "refresh";
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access" });
    if (url.includes("/drafts?q=")) return Response.json({ drafts: [{ id: "gmail-draft-1", message: { id: "gmail-message-1" } }] });
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const result = await createOrReuseGmailDraft({
    revisionId: "revision-123",
    to: "careers@example.com",
    subject: "Product internship",
    body: "Hello",
  }, fetcher);
  assert.equal(result.reused, true);
  assert.equal(result.draftId, "gmail-draft-1");
  assert.equal(calls.length, 2);
});

test("Gmail creation uses drafts.create only when no deterministic draft exists", async () => {
  process.env.SCOUT_GMAIL_CLIENT_ID = "client";
  process.env.SCOUT_GMAIL_CLIENT_SECRET = "secret";
  process.env.SCOUT_GMAIL_REFRESH_TOKEN = "refresh";
  let createdBody = "";
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access" });
    if (url.includes("/drafts?q=")) return Response.json({ drafts: [] });
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/drafts") {
      assert.equal(init?.method, "POST");
      createdBody = String(init?.body ?? "");
      return Response.json({ id: "gmail-draft-2", message: { id: "gmail-message-2" } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const result = await createOrReuseGmailDraft({ revisionId: "revision-456", to: "jobs@example.com", subject: "Internship", body: "Hello" }, fetcher);
  assert.equal(result.reused, false);
  assert.equal(result.draftId, "gmail-draft-2");
  assert.match(createdBody, /"message"/);
});

test("control-plane Gmail route is owner-only, same-origin, and approved-revision gated", async () => {
  const route = await readFile(new URL("../app/api/agent/create-gmail-draft/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /eq\(outreachDrafts\.state, "approved"\)/);
  assert.match(route, /draft\.approvedRevisionId/);
  assert.match(route, /createGmailDraftThroughAgent/);
  assert.doesNotMatch(route, /drafts\.send|messages\.send|sendEmail\(/);
});
