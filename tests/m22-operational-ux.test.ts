import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shortlist = await readFile(new URL("../app/shortlist/shortlist-client.tsx", import.meta.url), "utf8");
const inbox = await readFile(new URL("../app/inbox/inbox-client.tsx", import.meta.url), "utf8");
const applications = await readFile(new URL("../app/applications/workspace-client.tsx", import.meta.url), "utf8");

test("M22 presents Accept Watch Reject without changing Scout's persisted review states", () => {
  assert.match(shortlist, /updateJob\(job\.id, "shortlisted"\)\}>Accept<\/button>/);
  assert.match(shortlist, /updateJob\(job\.id, "saved"\)\}>Watch<\/button>/);
  assert.match(shortlist, /updateJob\(job\.id, "rejected"\)\}>Reject<\/button>/);
  assert.match(shortlist, /filter === "Accepted"\) return job\.state === "shortlisted"/);
  assert.match(shortlist, /filter === "Watch"\) return job\.state === "saved"/);
});

test("M22 makes evidence and qualification review explicit across discovery shortlist and Today", () => {
  assert.match(shortlist, /Why Scout surfaced this/);
  assert.match(shortlist, /Exact approved claim support/);
  assert.match(shortlist, /support\.claimIds\.join/);
  assert.match(shortlist, /Qualification \/ evidence checks/);
  assert.match(inbox, /discovery leads, not final fit decisions/);
  assert.match(inbox, /Exact approved claim IDs and qualification checks appear only after official resolution/);
  assert.match(inbox, /href="\/shortlist"/);
  assert.match(applications, /href=\{`\/roles\/\$\{job\.id\}`\}>Review role evidence/);
});

test("M22 remains review-only and does not add outbound execution", () => {
  const surface = `${shortlist}\n${inbox}\n${applications}`;
  assert.match(shortlist, /Accept, Watch and Reject change only Scout&apos;s local review state/);
  assert.doesNotMatch(surface, /\/api\/(?:send|submit|applications\/submit|outreach\/send)/i);
});
