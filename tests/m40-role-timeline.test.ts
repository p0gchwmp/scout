import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRoleTimeline, ROLE_TIMELINE_CAPABILITIES } from "../lib/scout/role-timeline.ts";

test("M40 builds one ordered role timeline without inventing communications", () => {
  const events = buildRoleTimeline({
    job: { id: "job", currentSnapshotId: "snap", lastSeenAt: "2026-08-28T09:00:00.000Z" },
    application: { id: "app", status: "interview", createdAt: "2026-08-29T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z", submittedAt: "2026-08-30T09:00:00.000Z" },
    contacts: [{ id: "contact", email: "recruiting@example.com", sourceUrl: "https://example.com/careers", reviewState: "accepted", extractedAt: "2026-08-29T10:00:00.000Z" }],
    drafts: [{ id: "draft", state: "approved", approvedAt: "2026-08-29T12:00:00.000Z", revisions: [{ id: "rev", version: 1, createdAt: "2026-08-29T11:00:00.000Z" }] }],
  });
  assert.deepEqual(events.map((event) => event.kind), [
    "official_evidence", "application_prepared", "contact_evidence", "outreach_drafted", "outreach_reviewed", "application_submitted", "outcome_recorded",
  ]);
  assert.match(events.find((event) => event.kind === "outreach_reviewed")!.detail, /not evidence that an email was sent/);
  assert.equal(ROLE_TIMELINE_CAPABILITIES.readGmailThreads, false);
  assert.equal(ROLE_TIMELINE_CAPABILITIES.inferRecruiterMessages, false);
  assert.equal(ROLE_TIMELINE_CAPABILITIES.send, false);
  assert.equal(ROLE_TIMELINE_CAPABILITIES.submit, false);
});

test("M40 timeline UI is owner-only and discoverable from the role cockpit", async () => {
  const [page, client, rolePage] = await Promise.all([
    readFile(new URL("../app/roles/[jobId]/timeline/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roles/[jobId]/timeline/role-timeline-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roles/[jobId]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(client, /Timeline ≠ inbox surveillance/);
  assert.match(client, /\/api\/applications/);
  assert.match(client, /\/api\/contacts/);
  assert.match(client, /\/api\/outreach/);
  assert.match(rolePage, /timeline/);
  assert.doesNotMatch(client, /method:\s*["']POST["']/);
});
