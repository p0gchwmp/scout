import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/ecosystem/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/ecosystem/ecosystem-client.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("M14 ecosystem workspace remains owner-only", () => {
  assert.match(page, /requireChatGPTUser\("\/ecosystem"\)/);
  assert.match(page, /requireScoutPageOwner\(user, getScoutOwnerUserId\)/);
});

test("M14 exposes M13 actions without adding a parallel mutation API", () => {
  assert.match(client, /fetch\("\/api\/ecosystem"/);
  assert.match(client, /"discover" \| "seed_recruiting_targets" \| "research_public_contacts"/);
  assert.match(client, /JSON\.stringify\(\{ action \}\)/);
  assert.doesNotMatch(client, /fetch\("\/api\/ecosystem\/send|fetch\("\/api\/ecosystem\/apply/);
});

test("M14 visibly preserves lead-resolution boundaries", () => {
  assert.match(client, /Review source before any job\/contact trust/);
  assert.match(client, /Resolve portfolio employer to official job\/ATS/);
  assert.match(client, /Search snippets remain ephemeral and are not trusted job evidence/);
  assert.match(client, /public contacts stay <strong>needs_review<\/strong>/);
});

test("M14 does not add autonomous send, submit, guessed-email, private-contact or CAPTCHA behavior", () => {
  assert.match(client, /does not guess emails, scrape personal contacts, bypass CAPTCHA\/login, send outreach, or submit applications/);
  assert.match(client, /create a Gmail draft/);
  assert.match(client, /No email was sent/);
  assert.match(client, /Nothing was sent/);
  assert.doesNotMatch(client, /messages\.send|drafts\.send|submitApplication\s*:\s*true|sendEmail\s*:\s*true|guessEmails\s*:\s*true|scrapePersonalContacts\s*:\s*true/);
});


test("M14 is reachable from the main owner workspace navigation", () => {
  assert.match(home, /\["Ecosystem", "\/ecosystem"\]/);
});
