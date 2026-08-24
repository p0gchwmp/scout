import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Run Scout now is owner-only, same-origin and has no send/submit surface", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /client\.discoverInternships\(\)/);
  assert.match(route, /client\.resolveJob\(\{ canonicalUrl: lead\.canonicalUrl \}\)/);
  assert.match(route, /client\.researchContacts/);
  assert.match(route, /client\.classifyContacts/);
  assert.doesNotMatch(route, /request\.json\(\)/);
  assert.doesNotMatch(route, /sendEmail\(|submitApplication\(|drafts\.send|messages\.send/);
  assert.match(route, /sendEmail: false/);
  assert.match(route, /submitApplication: false/);
  assert.match(route, /autoAcceptContact: false/);
  assert.match(route, /autoApproveApplication: false/);
});

test("Run Scout now is bounded and leaves contact decisions to human review", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /MAX_RESOLUTIONS_PER_RUN = 12/);
  assert.match(route, /MAX_APPLICATION_PREP_PER_RUN = 24/);
  assert.match(route, /MAX_CONTACT_RESEARCH_PER_RUN = 6/);
  assert.match(route, /reviewState: "needs_review"/);
  assert.doesNotMatch(route, /reviewState:\s*"accepted"/);
  assert.doesNotMatch(route, /reviewState:\s*"rejected"/);
});

test("Internship Inbox uses cloud Run Scout first and localhost only as a loopback fallback", async () => {
  const ui = await readFile(new URL("../app/inbox/inbox-client.tsx", import.meta.url), "utf8");
  assert.match(ui, /fetch\("\/api\/agent\/run", \{ method: "POST" \}\)/);
  assert.match(ui, /function isLoopbackBrowser\(\)/);
  assert.match(ui, /if \(!isLoopbackBrowser\(\)\)/);
  assert.match(ui, /127\.0\.0\.1:43119\/discover/);
  assert.match(ui, /const response = await fetch\("\/api\/agent\/run"[\s\S]*await runLocalDevelopmentFallback\(\)/);
  assert.match(ui, />Run Scout now</);
});
