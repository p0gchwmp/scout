import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ALWAYS_CONFIRM_APPLICATION_FIELDS,
  REQUIRED_APPLICATION_PROFILE_KEYS,
} from "../lib/scout/application-prep.ts";
import { selectUsableApprovedClaims } from "../lib/scout/claims.ts";
import { classifyFormField, type ObservedFormField } from "../lib/scout/form-intelligence.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  applicationPrep,
  resumeAlignment,
  setup,
  deterministicOutreach,
  aiOutreach,
  autoOutreach,
  browserExchange,
] = await Promise.all([
  read("lib/scout/application-prep.ts"),
  read("lib/scout/resume-alignment.ts"),
  read("app/setup/setup-client.tsx"),
  read("app/api/outreach/route.ts"),
  read("app/api/agent/draft-outreach/route.ts"),
  read("app/api/agent/draft-outreach/auto/route.ts"),
  read("app/api/applications/browser-task/exchange/route.ts"),
]);

const observedField = (label: string): ObservedFormField => ({
  id: "field-1",
  label,
  controlKind: "input",
  inputType: "text",
  maxLength: 120,
  required: true,
});

test("live reusable evidence excludes synthetic demo claims and unanchored metrics", () => {
  const claims = [
    {
      id: "resume-clean",
      statement: "Mapped clinic workflows and tested a Node.js prototype.",
      evidence: "Node.js prototype, workflow mapping and automated tests.",
      status: "approved" as const,
    },
    {
      id: "demo_claim_duplicate",
      statement: "Mapped clinic workflows and tested a Node.js prototype.",
      evidence: "LOCAL DEMO ONLY — replace/review against source documents before any external use.",
      status: "approved" as const,
    },
    {
      id: "resume-metric",
      statement: "Created 14 automated tests for the prototype.",
      evidence: "Prototype test suite.",
      status: "approved" as const,
    },
  ];

  assert.deepEqual(selectUsableApprovedClaims(claims).map((claim) => claim.id), ["resume-clean"]);
  assert.deepEqual(
    selectUsableApprovedClaims(claims, { allowSyntheticDemo: true }).map((claim) => claim.id),
    ["resume-clean"],
  );
  assert.deepEqual(
    selectUsableApprovedClaims([claims[1]], { allowSyntheticDemo: true }).map((claim) => claim.id),
    ["demo_claim_duplicate"],
  );
});

test("ranking and application preparation both use the centralized reusable-claim selector", () => {
  assert.match(resumeAlignment, /selectUsableApprovedClaims\(claims/);
  assert.match(resumeAlignment, /allowSyntheticDemo: job\.id\?\.startsWith\("demo_job_"\) === true/);
  assert.match(applicationPrep, /selectUsableApprovedClaims\(input\.claims/);
  assert.match(applicationPrep, /allowSyntheticDemo: input\.job\.id\.startsWith\("demo_job_"\)/);
});

test("graduation year and degree path can never become universal Safe Fill facts", () => {
  assert.equal(REQUIRED_APPLICATION_PROFILE_KEYS.includes("graduation_year"), false);
  assert.equal(ALWAYS_CONFIRM_APPLICATION_FIELDS.includes("graduation_year"), true);
  const classified = classifyFormField(observedField("Expected graduation year"));
  assert.equal(classified.category, "needs_user_answer");
  assert.equal(classified.sourceField, null);
  assert.match(classified.reason, /confirmed for each application/i);
  assert.match(setup, /Manual per application/);
  assert.match(setup, /2028 \(B\.S\. exit\) \/ 2029 \(B\.S\. Honours with Research\)/);
});

test("manual deterministic and AI outreach reject claims outside the reusable evidence policy", () => {
  for (const route of [deterministicOutreach, aiOutreach]) {
    assert.match(route, /selectUsableApprovedClaims/);
    assert.match(route, /allowSyntheticDemo: job\.id\.startsWith\("demo_job_"\)/);
    assert.match(route, /usableClaims/);
    assert.doesNotMatch(route, /messages\.send|drafts\.send|submitApplication\(/);
  }
});

test("automatic outreach can only choose role-relevant ids emitted by safe resume alignment", () => {
  assert.match(autoOutreach, /evaluateResumeAlignment\(job, approvedClaims\)/);
  assert.match(autoOutreach, /alignment\.supportingClaims\.flatMap\(\(support\) => support\.claimIds\)/);
  assert.match(autoOutreach, /approvedClaims\.filter\(\(claim\) => relevantClaimIds\.includes\(claim\.id\)\)/);
  assert.match(autoOutreach, /eq\(contactEvidence\.reviewState, "accepted"\)/);
  assert.match(autoOutreach, /job\.currentSnapshotId !== contact\.jobSnapshotId/);
  assert.doesNotMatch(autoOutreach, /messages\.send|drafts\.send|submitApplication\(/);
});

test("browser AI drafting takes claim ids only from the pinned application packet and keeps review mandatory", () => {
  assert.match(browserExchange, /const packet = application\.submittedFields/);
  assert.match(browserExchange, /const claimIds = Array\.isArray\(packet\.claimIds\)/);
  assert.doesNotMatch(browserExchange, /input\.claimIds|record\.claimIds/);
  assert.match(browserExchange, /claims\.every\(\(claim\) => claim\.status === "approved"\)/);
  assert.match(browserExchange, /aiAnswersRequireExplicitApprovalBeforeFill: true/);
  assert.match(browserExchange, /submitApplication: false/);
});
