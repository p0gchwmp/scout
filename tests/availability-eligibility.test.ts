import assert from "node:assert/strict";
import test from "node:test";
import { buildApplicationPreparation } from "../lib/scout/application-prep.ts";
import { assessAvailability, isOwnerBreakWindow, OWNER_AVAILABILITY_POLICY } from "../lib/scout/availability-eligibility.ts";
import { evaluateShortlist } from "../lib/scout/shortlist-intelligence.ts";

const semester = new Date("2026-09-12T08:00:00Z");
const mayBreak = new Date("2027-05-15T08:00:00Z");

const claims = [
  {
    id: "claim-product",
    statement: "Translated clinic operations into product requirements, workflows and testing.",
    evidence: "Approved product and operations evidence.",
    status: "approved" as const,
  },
  {
    id: "claim-research",
    statement: "Reviewed data and technical documentation for research work.",
    evidence: "Approved research evidence.",
    status: "approved" as const,
  },
];

const profileFields = [
  ["full_name", "Ryan Vivek Mahajan"],
  ["email", "student@example.com"],
  ["current_location", "Student residence"],
  ["university", "IIM Sambalpur"],
  ["program", "B.S. Management and Public Policy"],
  ["resume_reference", "approved-resume-v1"],
].map(([kind, claim], index) => ({ id: `profile-${index}`, kind, claim, evidence: "Owner verified", verified: true }));

test("owner availability policy encodes semester and break windows without inferring work authorization", () => {
  assert.equal(OWNER_AVAILABILITY_POLICY.semesterMode, "part_time_flexible_only");
  assert.equal(OWNER_AVAILABILITY_POLICY.sixMonthOnsiteAllowed, false);
  assert.equal(isOwnerBreakWindow(semester), false);
  assert.equal(isOwnerBreakWindow(new Date("2026-12-15T08:00:00Z")), true);
  assert.equal(isOwnerBreakWindow(new Date("2027-01-15T08:00:00Z")), true);
  assert.equal(isOwnerBreakWindow(mayBreak), true);
  assert.equal(isOwnerBreakWindow(new Date("2027-07-15T08:00:00Z")), true);
});

test("six-month onsite roles are a hard mismatch even during a break window", () => {
  const role = {
    title: "Product Management Intern",
    description: "This is a full-time internship for 6 months.",
    location: "Noida, India",
    workplaceType: "on-site",
  };
  const duringSemester = assessAvailability(role, semester);
  const duringBreak = assessAvailability(role, mayBreak);
  assert.equal(duringSemester.lane, "hard_mismatch");
  assert.equal(duringBreak.lane, "hard_mismatch");
  assert.match(duringSemester.reasons.join(" "), /six-month on-site\/hybrid/i);
});

test("six-hours-per-day remote roles are break-only in semester and compatible during breaks", () => {
  const role = {
    title: "Revenue & Operations Intern",
    description: "College students may apply. You must commit at least 6 hours per day, Monday-Friday.",
    location: "Bengaluru, India / Remote",
    workplaceType: "remote",
  };
  assert.equal(assessAvailability(role, semester).lane, "break_only");
  assert.equal(assessAvailability(role, mayBreak).lane, "compatible_now");
});

test("part-time flexible remote roles are semester-compatible while unknown schedules require verification", () => {
  const compatible = assessAvailability({
    title: "Policy Research Intern",
    description: "Part-time role with flexible hours and remote collaboration.",
    location: "Remote",
    workplaceType: "remote",
  }, semester);
  const unknown = assessAvailability({
    title: "Product Intern",
    description: "Support product research and documentation.",
    location: "Remote",
    workplaceType: "remote",
  }, semester);
  assert.equal(compatible.lane, "compatible_now");
  assert.equal(compatible.label, "Semester-compatible");
  assert.equal(unknown.lane, "needs_verification");
});

test("shortlist priority is capped by availability separately from resume overlap", () => {
  const feasible = evaluateShortlist({
    title: "Product Operations Intern",
    description: "Part-time flexible hours. Support product workflows, research and documentation.",
    location: "Remote",
    workplaceType: "remote",
    postedAt: "2026-09-11T00:00:00Z",
    currentSnapshotId: "snapshot-feasible",
  }, claims, semester);
  const breakOnly = evaluateShortlist({
    title: "Product Operations Intern",
    description: "Full-time role, at least 6 hours per day Monday-Friday. Support product workflows, research and documentation.",
    location: "Remote",
    workplaceType: "remote",
    postedAt: "2026-09-11T00:00:00Z",
    currentSnapshotId: "snapshot-break",
  }, claims, semester);
  const mismatch = evaluateShortlist({
    title: "Product Operations Intern",
    description: "Full-time 6-month internship. Support product workflows, research and documentation.",
    location: "Bengaluru, India",
    workplaceType: "on-site",
    postedAt: "2026-09-11T00:00:00Z",
    currentSnapshotId: "snapshot-mismatch",
  }, claims, semester);

  assert.equal(feasible.availabilityLane, "compatible_now");
  assert.equal(breakOnly.availabilityLane, "break_only");
  assert.equal(breakOnly.priority, "consider");
  assert.equal(mismatch.availabilityLane, "hard_mismatch");
  assert.equal(mismatch.priority, "low");
  assert.ok(feasible.score > breakOnly.score);
  assert.ok(breakOnly.score > mismatch.score);
});

test("application preparation blocks hard mismatches but keeps unknown availability as manual review", () => {
  const hardMismatch = buildApplicationPreparation({
    job: {
      id: "paytm-like",
      company: "Example",
      title: "Product Management Intern",
      canonicalUrl: "https://jobs.lever.co/example/123",
      currentSnapshotId: "snapshot-1",
      description: "Full-time internship for 6 months.",
      location: "Noida, India",
      workplaceType: "on-site",
    },
    profileFields,
    claims,
    now: semester,
  });
  assert.equal(hardMismatch.status, "needs_input");
  assert.equal(hardMismatch.packet.availability?.lane, "hard_mismatch");
  assert.ok(hardMismatch.blockers.some((blocker) => blocker.startsWith("Availability mismatch:")));

  const unknown = buildApplicationPreparation({
    job: {
      id: "unknown-hours",
      company: "Example",
      title: "Research Intern",
      canonicalUrl: "https://jobs.lever.co/example/456",
      currentSnapshotId: "snapshot-2",
      description: "Research and documentation internship.",
      location: "Remote",
      workplaceType: "remote",
    },
    profileFields,
    claims,
    now: semester,
  });
  assert.equal(unknown.status, "ready_for_review");
  assert.equal(unknown.packet.availability?.lane, "needs_verification");
  assert.equal(unknown.packet.availabilityReviewRequired, true);
  assert.ok(unknown.packet.alwaysConfirmPerApplication.includes("availability"));
  assert.ok(!unknown.blockers.some((blocker) => /Availability/i.test(blocker)));
});
