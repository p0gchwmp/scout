import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoNewAnchoredFacts,
  HUMAN_WRITING_CAPABILITIES,
  humanWritingSystemInstruction,
  lintHumanWriting,
  sameStringSet,
} from "../lib/scout/human-writing.ts";

test("human writing layer preserves Scout safety boundaries", () => {
  assert.equal(HUMAN_WRITING_CAPABILITIES.rewriteStyle, true);
  assert.equal(HUMAN_WRITING_CAPABILITIES.preserveClaims, true);
  assert.equal(HUMAN_WRITING_CAPABILITIES.inventFacts, false);
  assert.equal(HUMAN_WRITING_CAPABILITIES.changeEligibility, false);
  assert.equal(HUMAN_WRITING_CAPABILITIES.evadeDetectionGuarantee, false);
});

test("human writing lint catches stock AI outreach patterns", () => {
  const warnings = lintHumanWriting(
    "I hope this email finds you well. I am thrilled to leverage my skills in this pivotal and dynamic landscape — and make a meaningful impact. 🚀",
    "outreach",
  );
  const ids = new Set(warnings.map((warning) => warning.id));
  for (const expected of ["generic-email-opening", "inflated-enthusiasm", "ai-vocabulary", "corporate-fluff", "em-dash", "emoji"]) {
    assert.ok(ids.has(expected), `missing ${expected}`);
  }
});

test("verified voice sample can preserve deliberate dash style", () => {
  const warnings = lintHumanWriting("I built the prototype — then tested the edge cases.", "outreach", "I tend to use dashes — sparingly — in short notes.");
  assert.equal(warnings.some((warning) => warning.id === "em-dash"), false);
});

test("human writing rejects newly invented numerical or contact anchors", () => {
  const source = "Ryan is in the 2025-2029 cohort. Contact careers@example.com.";
  assert.doesNotThrow(() => assertNoNewAnchoredFacts("I am in the 2025-2029 cohort.", source));
  assert.throws(() => assertNoNewAnchoredFacts("I improved conversion by 37%.", source), /number or metric/);
  assert.throws(() => assertNoNewAnchoredFacts("You can reach me at other@example.com.", source), /email address/);
});

test("rewrite pass must preserve the exact used claim id set", () => {
  assert.equal(sameStringSet(["claim-b", "claim-a"], ["claim-a", "claim-b"]), true);
  assert.equal(sameStringSet(["claim-a"], ["claim-a", "claim-b"]), false);
});

test("style instruction explicitly forbids factual embellishment", () => {
  const prompt = humanWritingSystemInstruction("application_answer", "Short sample.");
  assert.match(prompt, /Do not invent a credential, metric, result, date, eligibility fact, referral/i);
  assert.match(prompt, /verified writing sample/i);
  assert.doesNotMatch(prompt, /evade|detector|undetectable/i);
});
