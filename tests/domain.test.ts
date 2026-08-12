import assert from "node:assert/strict";
import test from "node:test";
import { rankJob, isEligibleForDailyQueue } from "../lib/ranking.ts";
import { evaluateSubmission } from "../lib/submission-policy.ts";

const profile = { roleKeywords: ["product", "operations"], verifiedSkills: ["sql", "research"], preferredLocations: ["india"], currentStudent: true, remoteAllowed: true, workAuthorizedCountries: ["IN"] };

test("ranking rewards evidenced, student-friendly India roles", () => {
  const ranked = rankJob({ source: "test", externalId: "1", canonicalUrl: "https://example.com/1", company: "Example", title: "Product Intern", description: "Undergraduate student using SQL and research", location: "Bengaluru, India", workplaceType: "hybrid", postedAt: "2026-08-11" }, profile, new Date("2026-08-12"));
  assert.ok(ranked.score >= 90);
  assert.equal(isEligibleForDailyQueue(ranked), true);
  assert.ok(ranked.reasons.includes("Student-friendly"));
});

test("submission policy pauses on sensitive or unsupported fields", () => {
  const result = evaluateSubmission("boards.greenhouse.io", [{ key: "email", label: "Email", kind: "text", value: "a@example.com", verified: true }, { key: "visa", label: "Will you need sponsorship?", kind: "radio", value: "no", verified: true }], ["boards.greenhouse.io"]);
  assert.equal(result.canAutoSubmit, false);
  assert.match(result.blockers.join(" "), /sponsorship/i);
});
