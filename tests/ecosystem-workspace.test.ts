import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const client = await readFile(new URL("../app/ecosystem/ecosystem-client.tsx", import.meta.url), "utf8");
test("M14 action contracts remain visible", () => {
  assert.match(client, /fetch\("\/api\/ecosystem"/);
  assert.match(client, /"discover" \| "seed_recruiting_targets" \| "research_public_contacts"/);
  assert.match(client, /JSON\.stringify\(\{ action \}\)/);
});
test("M14 lead and execution boundaries remain visible", () => {
  assert.match(client, /Review source before any job\/contact trust/);
  assert.match(client, /Resolve portfolio employer to official job\/ATS/);
  assert.match(client, /Search snippets remain ephemeral and are not trusted job evidence/);
  assert.match(client, /public contacts stay <strong>needs_review<\/strong>/);
  assert.match(client, /does not guess emails, scrape personal contacts, bypass CAPTCHA\/login, send outreach, or submit applications/);
  assert.match(client, /create a Gmail draft/);
  assert.match(client, /No email was sent/);
  assert.match(client, /Nothing was sent/);
});
