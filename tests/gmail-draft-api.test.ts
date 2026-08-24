import assert from "node:assert/strict";
import test from "node:test";
import { buildGmailDraftFromOutreach, buildGmailDraftRawMessage, createGmailDraftClient, GMAIL_DRAFT_API_CAPABILITIES } from "../lib/scout/gmail-draft-api.ts";

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Buffer.from(base64, "base64").toString("utf8");
}

test("Gmail draft builder pins one recipient and Scout revision without send capability", () => {
  assert.equal(GMAIL_DRAFT_API_CAPABILITIES.createDraft, true);
  assert.equal(GMAIL_DRAFT_API_CAPABILITIES.sendEmail, false);
  assert.equal(GMAIL_DRAFT_API_CAPABILITIES.sendDraft, false);
  const raw = buildGmailDraftRawMessage({
    to: "careers@example.com",
    subject: "Product internship — Ryan",
    body: "Hi team,\n\nA short note.\n\nBest,\nRyan",
    scoutRevisionId: "revision-123",
  });
  const decoded = decodeBase64Url(raw);
  assert.match(decoded, /^To: careers@example\.com\r\n/m);
  assert.match(decoded, /X-Scout-Revision-ID: revision-123/);
  assert.match(decoded, /Content-Type: text\/plain; charset=UTF-8/);
  assert.doesNotMatch(decoded, /Bcc:|Cc:/i);
});

test("Gmail draft builder parses existing pinned Scout outreach format", () => {
  const result = buildGmailDraftFromOutreach("To: recruiting@example.com\nSubject: Internship\n\nHello recruiting team.", "rev-9");
  assert.equal(result.parsed.to, "recruiting@example.com");
  assert.match(decodeBase64Url(result.raw), /Subject: Internship/);
});

test("Gmail draft client calls only users.me.drafts create endpoint", async () => {
  let called = "";
  const client = createGmailDraftClient({
    accessToken: "test-access-token-123456789",
    fetcher: (async (input, init) => {
      called = String(input);
      assert.equal(init?.method, "POST");
      assert.equal(called, "https://gmail.googleapis.com/gmail/v1/users/me/drafts");
      assert.doesNotMatch(called, /send/i);
      const body = JSON.parse(String(init?.body)) as { message?: { raw?: string } };
      assert.ok(body.message?.raw);
      return Response.json({ id: "draft-1", message: { id: "message-1", threadId: "thread-1" } });
    }) as typeof fetch,
  });
  const result = await client.createDraft({ to: "careers@example.com", subject: "Internship", body: "Hello.", scoutRevisionId: "rev-10" });
  assert.deepEqual(result, { draftId: "draft-1", messageId: "message-1", threadId: "thread-1" });
});

test("Gmail draft builder rejects header injection and multiple recipients", () => {
  assert.throws(() => buildGmailDraftRawMessage({ to: "a@example.com,b@example.com", subject: "Hello", body: "Body", scoutRevisionId: "rev-11" }), /one valid email/);
  assert.throws(() => buildGmailDraftRawMessage({ to: "a@example.com", subject: "Hello\nBcc: x@example.com", body: "Body", scoutRevisionId: "rev-11" }), /Subject is invalid/);
});
