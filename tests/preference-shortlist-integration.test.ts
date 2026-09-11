import assert from "node:assert/strict";
import test from "node:test";
import { buildPreferenceCalibration } from "../lib/scout/preference-calibration.ts";
import { evaluateShortlist } from "../lib/scout/shortlist-intelligence.ts";

const claims = [
  { id: "claim-analysis", status: "approved" as const, statement: "Reviewed data and analyzed operational patterns.", evidence: "ADR data review and workflow analysis." },
  { id: "claim-product", status: "approved" as const, statement: "Mapped product workflows and requirements.", evidence: "Clinic operations prototype requirements and testing." },
];

const feedbackJobs = [
  { id: "a1", title: "Business Analyst Intern", description: "Business analysis and data insights." },
  { id: "a2", title: "Data Analyst Intern", description: "Data analytics and dashboards." },
  { id: "o1", title: "Operations Intern", description: "Operations execution." },
  { id: "o2", title: "Program Operations Intern", description: "Program operations." },
];
const calibration = buildPreferenceCalibration(feedbackJobs, [
  { jobId: "a1", signal: "interested" as const, recordedAt: "2026-08-20T00:00:00Z" },
  { jobId: "a2", signal: "interested" as const, recordedAt: "2026-08-21T00:00:00Z" },
  { jobId: "o1", signal: "not_interested" as const, recordedAt: "2026-08-22T00:00:00Z" },
  { jobId: "o2", signal: "not_interested" as const, recordedAt: "2026-08-23T00:00:00Z" },
]);

const now = new Date("2026-08-25T00:00:00Z");

test("repeated feedback adds only the bounded family nudge", () => {
  const job = {
    title: "Business Analyst Intern",
    description: "Analyze data, workflows and product operations.",
    location: "Singapore",
    postedAt: "2026-08-24T00:00:00Z",
    currentSnapshotId: "snapshot",
    eligibilityRisks: [],
  };
  const without = evaluateShortlist(job, claims, now);
  const withCalibration = evaluateShortlist(job, claims, now, calibration);
  assert.equal(withCalibration.learnedPreferencePoints, 4);
  assert.equal(withCalibration.score - without.score, 4);
});

test("preference calibration does not introduce geography bias", () => {
  const indiaJob = {
    title: "Business Analyst Intern",
    description: "Analyze data and workflows.",
    location: "Bengaluru, India",
    postedAt: "2026-08-24T00:00:00Z",
    currentSnapshotId: "india",
  };
  const londonJob = {
    title: "Business Analyst Intern",
    description: "Analyze data and workflows.",
    location: "London, United Kingdom",
    postedAt: "2026-08-24T00:00:00Z",
    currentSnapshotId: "london",
  };

  const indiaWithout = evaluateShortlist(indiaJob, claims, now);
  const londonWithout = evaluateShortlist(londonJob, claims, now);
  const indiaWith = evaluateShortlist(indiaJob, claims, now, calibration);
  const londonWith = evaluateShortlist(londonJob, claims, now, calibration);

  assert.equal(indiaWith.learnedPreferencePoints, 4);
  assert.equal(londonWith.learnedPreferencePoints, 4);
  assert.equal(indiaWith.score - indiaWithout.score, 4);
  assert.equal(londonWith.score - londonWithout.score, 4);
  assert.ok(indiaWith.score > londonWith.score);
});

test("positive preference cannot erase explicit eligibility gaps", () => {
  const result = evaluateShortlist({
    title: "Business Analyst Intern",
    description: "Analyze business data. Driver's licence required.",
    location: "Toronto, Canada",
    postedAt: "2026-08-24T00:00:00Z",
    currentSnapshotId: "snapshot",
  }, claims, now, calibration);
  assert.equal(result.learnedPreferencePoints, 4);
  assert.ok(result.gaps.some((gap) => /Driver's licence/.test(gap)));
  assert.equal(result.alignment.band, "stretch");
});
