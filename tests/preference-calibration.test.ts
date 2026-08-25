import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreferenceCalibration,
  parsePreferenceFeedback,
  PREFERENCE_CALIBRATION_CAPABILITIES,
  recordPreferenceFeedback,
  serializePreferenceFeedback,
  type PreferenceFeedback,
} from "../lib/scout/preference-calibration.ts";

const jobs = [
  { id: "analytics-1", title: "Business Analyst Intern", description: "Analyze business metrics and operations data." },
  { id: "analytics-2", title: "Data Analyst Intern", description: "Data analytics, dashboards and insights." },
  { id: "ops-1", title: "Operations Intern", description: "Workflow and operations execution." },
  { id: "ops-2", title: "Program Operations Intern", description: "Program operations and process improvement." },
  { id: "software-1", title: "Software Engineering Intern", description: "Backend software engineering and APIs." },
];

function feedback(items: Array<[string, PreferenceFeedback["signal"]]>): PreferenceFeedback[] {
  return items.map(([jobId, signal], index) => ({ jobId, signal, recordedAt: `2026-08-${String(20 + index).padStart(2, "0")}T00:00:00Z` }));
}

test("one rejection cannot bias a role family", () => {
  const result = buildPreferenceCalibration(jobs, feedback([["analytics-1", "not_interested"]]));
  assert.equal(result.active, false);
  assert.equal(result.families.find((family) => family.familyId === "analytics")?.adjustment, 0);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.singleRejectionCanBlockFamily, false);
});

test("repeated explicit decisions create bounded family nudges only after calibration activates", () => {
  const result = buildPreferenceCalibration(jobs, feedback([
    ["analytics-1", "interested"],
    ["analytics-2", "interested"],
    ["ops-1", "not_interested"],
    ["ops-2", "not_interested"],
  ]));
  assert.equal(result.active, true);
  assert.equal(result.totalSignals, 4);
  assert.equal(result.families.find((family) => family.familyId === "analytics")?.adjustment, 4);
  assert.equal(result.families.find((family) => family.familyId === "operations")?.adjustment, -4);
});

test("software-development feedback can nudge but never becomes a hard include or exclude rule", () => {
  const expanded = [...jobs,
    { id: "software-2", title: "Backend Developer Intern", description: "Backend development and distributed systems." },
    { id: "product-1", title: "Product Operations Intern", description: "Product workflows and requirements." },
    { id: "research-1", title: "Research Intern", description: "Desk research and evidence synthesis." },
  ];
  const result = buildPreferenceCalibration(expanded, feedback([
    ["software-1", "interested"],
    ["software-2", "interested"],
    ["product-1", "not_interested"],
    ["research-1", "not_interested"],
  ]));
  const software = result.families.find((family) => family.familyId === "software_development")!;
  assert.equal(software.adjustment, 4);
  assert.ok(Math.abs(software.adjustment) <= PREFERENCE_CALIBRATION_CAPABILITIES.maximumAbsoluteNudge);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.automaticRoleHiding, false);
});

test("saved or discovered job state cannot become preference feedback accidentally", () => {
  const result = buildPreferenceCalibration(jobs, []);
  assert.equal(result.totalSignals, 0);
  assert.equal(result.families.every((family) => family.adjustment === 0), true);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.savedStateIsNeutral, true);
});

test("feedback storage is bounded, validated and reversible", () => {
  let current: PreferenceFeedback[] = [];
  current = recordPreferenceFeedback(current, "analytics-1", "interested", "2026-08-25T00:00:00Z");
  current = recordPreferenceFeedback(current, "analytics-1", "not_interested", "2026-08-25T01:00:00Z");
  assert.deepEqual(current, [{ jobId: "analytics-1", signal: "not_interested", recordedAt: "2026-08-25T01:00:00Z" }]);
  current = recordPreferenceFeedback(current, "analytics-1", null, "2026-08-25T02:00:00Z");
  assert.deepEqual(current, []);

  const encoded = serializePreferenceFeedback(feedback([["analytics-1", "interested"]]));
  assert.equal(parsePreferenceFeedback(encoded).length, 1);
  assert.deepEqual(parsePreferenceFeedback("not-json"), []);
  assert.deepEqual(parsePreferenceFeedback(JSON.stringify({ schemaVersion: 1, feedback: [{ jobId: "x", signal: "invalid", recordedAt: "2026-08-25T00:00:00Z" }] })), []);
});

test("preference calibration never learns geography", () => {
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.geographyLearning, false);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.hardEligibilityUnaffected, true);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.approvedEvidenceUnaffected, true);
});
