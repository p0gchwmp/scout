import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Applications workspace exposes Today Soon Waiting Done as a conservative action queue", async () => {
  const client = await readFile(new URL("../app/applications/workspace-client.tsx", import.meta.url), "utf8");
  assert.match(client, /type Filter = "Today" \| "Soon" \| "Waiting" \| "Done" \| "All"/);
  assert.match(client, /assessFollowUp/);
  assert.match(client, /Today<\/span>/);
  assert.match(client, /Soon<\/span>/);
  assert.match(client, /Waiting<\/span>/);
  assert.match(client, /Done<\/span>/);
  assert.match(client, /does not invent recruiter-response or follow-up deadlines/i);
  assert.match(client, /Date was not parsed because Scout will not guess an ambiguous date/);
  assert.match(client, /Shown only from immutable official job evidence/);
});

test("follow-up workspace remains observational and never schedules or sends follow-up", async () => {
  const [client, intelligence] = await Promise.all([
    readFile(new URL("../app/applications/workspace-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/scout/follow-up-intelligence.ts", import.meta.url), "utf8"),
  ]);
  assert.match(intelligence, /inferRecruiterResponse: false/);
  assert.match(intelligence, /inferDeadline: false/);
  assert.match(intelligence, /scheduleFollowUp: false/);
  assert.match(intelligence, /sendFollowUp: false/);
  assert.match(client, /No follow-up is scheduled or sent automatically/);
  assert.doesNotMatch(client, /setInterval\(|setTimeout\([^)]*follow.?up|sendEmail|sendFollowUp|requestSubmit\(/i);
});
