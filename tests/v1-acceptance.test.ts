import assert from "node:assert/strict";
import test from "node:test";
import { SCOUT_V1_ACCEPTANCE, scoutV1AcceptanceIssues } from "../lib/scout/v1-acceptance.ts";

test("Scout v1 acceptance manifest has no unresolved contract issues", () => {
  assert.deepEqual(scoutV1AcceptanceIssues(), []);
});

test("Scout v1 is useful without becoming autonomous", () => {
  assert.equal(SCOUT_V1_ACCEPTANCE.workflow.oneRunOrchestration, true);
  assert.equal(SCOUT_V1_ACCEPTANCE.workflow.createGmailDraftAfterApproval, true);
  assert.equal(SCOUT_V1_ACCEPTANCE.workflow.safeFillWithCurrentSnapshotAndProfileBindings, true);
  assert.equal(SCOUT_V1_ACCEPTANCE.safety.sendEmail, false);
  assert.equal(SCOUT_V1_ACCEPTANCE.safety.submitApplication, false);
  assert.equal(SCOUT_V1_ACCEPTANCE.safety.autoAcceptContact, false);
});
