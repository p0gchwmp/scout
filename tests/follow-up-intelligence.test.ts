import assert from "node:assert/strict";
import test from "node:test";
import {
  FOLLOW_UP_CAPABILITIES,
  assessExplicitDeadline,
  assessFollowUp,
  parseExplicitDeadlineDate,
  roleFreshness,
} from "../lib/scout/follow-up-intelligence.ts";

const now = new Date(2026, 7, 25, 11, 42, 0);
const baseJob = {
  state: "shortlisted" as const,
  lifecycleState: "active" as const,
  currentSnapshotId: "snapshot-1",
  description: "Product internship. Apply by 27 August 2026.",
  postedAt: "2026-08-24T08:00:00.000Z",
  lastSeenAt: "2026-08-25T04:00:00.000Z",
};

const readyApplication = {
  status: "ready_for_review",
  submittedAt: null,
};

test("deadline parsing supports explicit global date formats but refuses ambiguous numeric dates", () => {
  assert.equal(parseExplicitDeadlineDate("Apply by 2026-09-15"), "2026-09-15");
  assert.equal(parseExplicitDeadlineDate("Applications close September 15, 2026"), "2026-09-15");
  assert.equal(parseExplicitDeadlineDate("Deadline 15 September 2026"), "2026-09-15");
  assert.equal(parseExplicitDeadlineDate("Deadline 25/09/2026"), "2026-09-25");
  assert.equal(parseExplicitDeadlineDate("Deadline 09/25/2026"), "2026-09-25");
  assert.equal(parseExplicitDeadlineDate("Deadline 09/10/2026"), null);
});

test("near explicit official deadlines land in Today and require immutable official evidence", () => {
  const deadline = assessExplicitDeadline(baseJob, now);
  assert.equal(deadline?.dateIso, "2026-08-27");
  assert.equal(deadline?.daysRemaining, 2);
  assert.match(deadline?.label ?? "", /2 days/i);

  const queue = assessFollowUp({ job: baseJob, application: readyApplication, contacts: [], drafts: [], now });
  assert.equal(queue.bucket, "today");

  const unresolved = assessFollowUp({
    job: { ...baseJob, currentSnapshotId: null },
    application: readyApplication,
    contacts: [],
    drafts: [],
    now,
  });
  assert.equal(unresolved.deadline, null);
  assert.equal(unresolved.bucket, "soon");
});

test("submitted roles wait without inventing recruiter response or follow-up deadlines", () => {
  const queue = assessFollowUp({
    job: baseJob,
    application: { status: "ready_for_review", submittedAt: "2026-08-20T12:00:00.000Z" },
    contacts: [],
    drafts: [],
    now,
  });
  assert.equal(queue.bucket, "waiting");
  assert.equal(queue.waitingDays, 4);
  assert.match(queue.reason, /does not infer recruiter response or a follow-up deadline/i);
});

test("human review decisions move submitted roles back to Today while optional outreach stays Soon", () => {
  const submitted = { status: "ready_for_review", submittedAt: "2026-08-20T12:00:00.000Z" };
  assert.equal(assessFollowUp({
    job: baseJob,
    application: submitted,
    contacts: [{ reviewState: "needs_review" }],
    drafts: [],
    now,
  }).bucket, "today");

  assert.equal(assessFollowUp({
    job: baseJob,
    application: submitted,
    contacts: [{ reviewState: "accepted" }],
    drafts: [],
    now,
  }).bucket, "soon");

  assert.equal(assessFollowUp({
    job: baseJob,
    application: submitted,
    contacts: [{ reviewState: "accepted" }],
    drafts: [{ state: "draft" }],
    now,
  }).bucket, "today");
});

test("rejected or closed unsubmitted work is Done and freshness is descriptive only", () => {
  const rejected = assessFollowUp({
    job: { ...baseJob, state: "rejected" as const },
    application: null,
    contacts: [],
    drafts: [],
    now,
  });
  assert.equal(rejected.bucket, "done");

  assert.deepEqual(roleFreshness("2026-08-24T08:00:00.000Z", baseJob.lastSeenAt, now), { ageDays: 1, label: "New posting" });
  assert.equal(FOLLOW_UP_CAPABILITIES.inferRecruiterResponse, false);
  assert.equal(FOLLOW_UP_CAPABILITIES.inferDeadline, false);
  assert.equal(FOLLOW_UP_CAPABILITIES.scheduleFollowUp, false);
  assert.equal(FOLLOW_UP_CAPABILITIES.sendFollowUp, false);
});
