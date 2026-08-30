import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCommandJobItem,
  ecosystemLeadNextAction,
  recommendJobNextAction,
  sortCommandJobs,
  summarizeCommandJobs,
} from "../lib/scout/opportunity-command-center.ts";

const base = {
  id: "job_1",
  company: "Example",
  title: "Product Intern",
  state: "saved",
  lifecycleState: "active",
  currentSnapshotId: "snap_1",
  canonicalUrl: "https://example.com/jobs/1",
  priority: "A" as const,
  priorityLabel: "Priority A",
  qualityLabel: "Strong evidence",
};

test("missing snapshot always routes to official evidence first", () => {
  const next = recommendJobNextAction({ ...base, currentSnapshotId: null });
  assert.equal(next.kind, "capture_evidence");
  assert.equal(next.href, "/evidence");
});

test("parked remains a review bucket rather than auto rejection", () => {
  const next = recommendJobNextAction({ ...base, priority: "parked" });
  assert.equal(next.kind, "review_quality");
  assert.match(next.reason, /not an automatic rejection/i);
});

test("application blockers outrank optional contact work", () => {
  const next = recommendJobNextAction({
    ...base,
    applicationStatus: "needs_input",
    contactStates: ["needs_review"],
  });
  assert.equal(next.kind, "resolve_application_input");
});

test("ready application packet routes to human review", () => {
  const next = recommendJobNextAction({ ...base, applicationStatus: "ready_for_review" });
  assert.equal(next.kind, "review_application");
  assert.equal(next.href, "/readiness");
});

test("official role with no packet routes to application preparation", () => {
  const next = recommendJobNextAction({ ...base, applicationStatus: null });
  assert.equal(next.kind, "prepare_application");
});

test("accepted contact only becomes optional outreach drafting after application exists", () => {
  const next = recommendJobNextAction({ ...base, applicationStatus: "prepared", contactStates: ["accepted"] });
  assert.equal(next.kind, "draft_outreach");
});

test("portfolio board leads must resolve the actual employer", () => {
  const next = ecosystemLeadNextAction({
    sourceId: "blume",
    sourceName: "Blume Ventures",
    sourceMode: "portfolio_board",
    title: "Business Operations Intern",
    url: "https://jobs.blume.vc/jobs/123",
    description: "",
    lane: "portfolio_talent",
    requiresOfficialSourceRegistration: false,
    requiresOfficialEmployerResolution: true,
  });
  assert.equal(next.kind, "resolve_portfolio_employer");
  assert.equal(next.external, true);
});

test("unregistered ecosystem leads stay source-review only", () => {
  const next = ecosystemLeadNextAction({
    sourceId: null,
    sourceName: "Unregistered investor",
    sourceMode: "ecosystem_index_lead",
    title: "Venture Intern",
    url: "https://example.vc/careers",
    description: "",
    lane: "capital_firms",
    requiresOfficialSourceRegistration: true,
    requiresOfficialEmployerResolution: true,
  });
  assert.equal(next.kind, "review_register_source");
});

test("sorting favors urgent evidence gaps before lower urgency review work", () => {
  const evidence = buildCommandJobItem({ ...base, id: "a", currentSnapshotId: null, priority: "B" });
  const outreach = buildCommandJobItem({ ...base, id: "b", applicationStatus: "prepared", contactStates: ["accepted"], priority: "A" });
  assert.deepEqual(sortCommandJobs([outreach, evidence]).map((item) => item.id), ["a", "b"]);
});

test("summary reports the human review workload", () => {
  const items = [
    buildCommandJobItem({ ...base, id: "a", currentSnapshotId: null }),
    buildCommandJobItem({ ...base, id: "b", applicationStatus: "ready_for_review" }),
    buildCommandJobItem({ ...base, id: "c", priority: "parked" }),
  ];
  const summary = summarizeCommandJobs(items);
  assert.equal(summary.total, 3);
  assert.equal(summary.needsEvidence, 1);
  assert.equal(summary.applicationReview, 1);
  assert.equal(summary.parked, 1);
});
