import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoleDecisionSummary,
  ROLE_DECISION_COCKPIT_CAPABILITIES,
} from "../lib/scout/role-decision-cockpit.ts";

function baseInput() {
  return {
    fit: { score: 82, label: "High priority", gaps: [], supportingClaimIds: ["claim-1"] },
    quality: { score: 84, label: "Strong opportunity evidence", tier: "strong_evidence" as const, flags: [] },
    preference: { points: 4, label: "+4 soft preference points", signalCount: 3 },
    readiness: { score: 90, label: "Ready for Safe Fill", status: "ready" as const, blockers: [] },
    progress: { summary: "Ready for reviewed application assistance.", externallySubmitted: false, nextAction: { kind: "safe_fill", label: "Open Safe Fill", href: "/assist" } },
    followUp: { bucket: "soon" as const, label: "Soon", reason: "Application is ready", deadline: null },
  };
}

test("cockpit never exposes a single composite score or automatic decision capability", () => {
  assert.equal(ROLE_DECISION_COCKPIT_CAPABILITIES.singleCompositeScore, false);
  assert.equal(ROLE_DECISION_COCKPIT_CAPABILITIES.autoShortlist, false);
  assert.equal(ROLE_DECISION_COCKPIT_CAPABILITIES.autoReject, false);
  assert.equal(ROLE_DECISION_COCKPIT_CAPABILITIES.autoApply, false);
  assert.equal(ROLE_DECISION_COCKPIT_CAPABILITIES.autoSendOutreach, false);
});

test("quality red flags take attention priority without changing the fit axis", () => {
  const input = baseInput();
  input.quality = { score: 32, label: "Red flag — review carefully", tier: "red_flag", flags: [{ severity: "high", label: "Candidate payment / fee language" }] };
  const result = buildRoleDecisionSummary(input);
  assert.match(result.headline, /Pause on opportunity quality/i);
  assert.ok(result.attention.some((item) => /red flags/i.test(item)));
  assert.equal(input.fit.score, 82);
});

test("submitted roles describe waiting without inventing recruiter-response deadlines", () => {
  const input = baseInput();
  input.progress = { summary: "Submitted", externallySubmitted: true, nextAction: { kind: "none", label: "No action", href: "/applications" } };
  input.followUp = { bucket: "waiting", label: "Waiting", reason: "Submitted externally", deadline: null };
  const result = buildRoleDecisionSummary(input);
  assert.match(result.headline, /waiting without inventing a recruiter-response deadline/i);
});

test("explicit fit gaps and deadlines stay visible alongside readiness", () => {
  const input = baseInput();
  input.fit = { score: 56, label: "Worth reviewing", gaps: ["Driver's licence is required but is not evidenced"], supportingClaimIds: ["claim-1"] };
  input.readiness = { score: 48, label: "Blocked before automation", status: "blocked", blockers: ["Official immutable job snapshot is missing"] };
  input.followUp = { bucket: "today", label: "Today", reason: "Deadline soon", deadline: { label: "Official deadline is tomorrow", raw: "Apply by 26 August 2026" } };
  const result = buildRoleDecisionSummary(input);
  assert.ok(result.attention.some((item) => /fit\/eligibility gap/i.test(item)));
  assert.ok(result.attention.some((item) => /application-readiness blocker/i.test(item)));
  assert.ok(result.attention.some((item) => /deadline/i.test(item)));
});
