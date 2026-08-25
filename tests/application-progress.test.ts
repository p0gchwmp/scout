import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_PROGRESS_CAPABILITIES,
  buildApplicationProgress,
  explicitDeadlineSignal,
} from "../lib/scout/application-progress.ts";

const job = {
  id: "job-1",
  state: "shortlisted" as const,
  lifecycleState: "active" as const,
  currentSnapshotId: "snapshot-1",
  description: "Product internship. Apply by September 15, 2026. Work with operations.",
  canonicalUrl: "https://jobs.example.com/role",
};

const application = {
  id: "application-1",
  status: "ready_for_review",
  blockers: [],
  artifactVersion: 3,
  submittedAt: null,
  confirmationUrl: null,
};

test("ready application points to Safe Fill without claiming Scout submitted or reviewed the form", () => {
  const progress = buildApplicationProgress({ job, application, contacts: [], drafts: [] });
  assert.equal(progress.nextAction.href, "/assist");
  assert.equal(progress.externallySubmitted, false);
  assert.equal(progress.stages.find((item) => item.id === "safe_fill")?.state, "done");
  assert.equal(progress.stages.find((item) => item.id === "external_submission")?.state, "current");
  assert.match(progress.summary, /submit it yourself/i);
});

test("recorded external submission advances to optional contact research without implying Scout submitted", () => {
  const progress = buildApplicationProgress({
    job,
    application: { ...application, submittedAt: "2026-08-25T05:30:00.000Z" },
    contacts: [],
    drafts: [],
  });
  assert.equal(progress.externallySubmitted, true);
  assert.equal(progress.nextAction.label, "Research contact");
  assert.match(progress.stages.find((item) => item.id === "external_submission")?.detail ?? "", /Scout did not submit it/i);
});

test("contact and outreach evidence determine the next review step", () => {
  const submitted = { ...application, submittedAt: "2026-08-25T05:30:00.000Z" };
  const contactReview = buildApplicationProgress({
    job,
    application: submitted,
    contacts: [{ reviewState: "needs_review" }],
    drafts: [],
  });
  assert.equal(contactReview.nextAction.href, "/review");

  const draftReview = buildApplicationProgress({
    job,
    application: submitted,
    contacts: [{ reviewState: "accepted" }],
    drafts: [{ state: "draft" }],
  });
  assert.equal(draftReview.nextAction.label, "Review outreach");
});

test("deadline signal is preserved only when the official text explicitly labels a deadline", () => {
  assert.equal(explicitDeadlineSignal("Interview on September 12, 2026."), null);
  assert.match(explicitDeadlineSignal("Applications close on 30 September 2026. Interviews follow.") ?? "", /Applications close/i);
  assert.match(explicitDeadlineSignal(job.description) ?? "", /Apply by September 15, 2026/i);
});

test("application progress has no submit, deadline inference, submission inference or form-review inference capability", () => {
  assert.equal(APPLICATION_PROGRESS_CAPABILITIES.recordExternalSubmission, true);
  assert.equal(APPLICATION_PROGRESS_CAPABILITIES.submitApplication, false);
  assert.equal(APPLICATION_PROGRESS_CAPABILITIES.inferSubmission, false);
  assert.equal(APPLICATION_PROGRESS_CAPABILITIES.inferDeadline, false);
  assert.equal(APPLICATION_PROGRESS_CAPABILITIES.inferFormReview, false);
});
