import assert from "node:assert/strict";
import test from "node:test";
import { evaluateResumeAlignment } from "../lib/scout/resume-alignment.ts";

test("dashboard compatibility fields stay synchronized with canonical resume alignment fields", () => {
  const ranked = evaluateResumeAlignment({
    title: "Product Operations Intern",
    description: "Support product workflows. Driver's licence required.",
    location: "Bengaluru, India",
  }, [{
    id: "claim-product",
    status: "approved",
    statement: "Built a clinic operations workflow prototype.",
    evidence: "Requirements mapping and automated tests.",
  }]);

  assert.deepEqual(ranked.eligibilityGaps, ranked.gaps);
  assert.deepEqual(ranked.caveats, ranked.notChecked);
  assert.ok(ranked.supportingClaims.every((support) => support.label === support.theme));

  const unranked = evaluateResumeAlignment({
    title: "Intern",
    description: "Remote internship",
    location: "Remote",
  }, []);
  assert.deepEqual(unranked.eligibilityGaps, []);
  assert.deepEqual(unranked.caveats, unranked.notChecked);
});
