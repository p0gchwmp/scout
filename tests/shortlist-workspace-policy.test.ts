import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shortlistPage = await readFile(new URL("../app/shortlist/page.tsx", import.meta.url), "utf8");
const shortlistClient = await readFile(new URL("../app/shortlist/shortlist-client.tsx", import.meta.url), "utf8");
const contactResearch = await readFile(new URL("../app/api/contacts/research/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("shortlist workspace remains owner-only and action-gated", () => {
  assert.match(shortlistPage, /requireChatGPTUser\("\/shortlist"\)/);
  assert.match(shortlistPage, /requireScoutPageOwner/);
  assert.match(worker, /"\/shortlist"/);

  assert.match(shortlistClient, /state: "shortlisted"/);
  assert.match(shortlistClient, /Prepare application/);
  assert.match(shortlistClient, /Research contact/);
  assert.match(shortlistClient, /Official posting/);
  assert.doesNotMatch(shortlistClient, /submit application|send email/i);
});

test("targeted contact research keeps provenance and mutation protections", () => {
  assert.match(contactResearch, /requireScoutApiUser/);
  assert.match(contactResearch, /requireSameOriginMutation/);
  assert.match(contactResearch, /extractPublishedBusinessEmails/);
  assert.match(contactResearch, /jobSnapshotId: snapshot\.id/);
  assert.match(contactResearch, /reviewState: "needs_review"/);
  assert.match(contactResearch, /emailSent: false/);
  assert.match(contactResearch, /contactAutoAccepted: false/);
  assert.doesNotMatch(contactResearch, /hunter|apollo|clearbit/i);
});
