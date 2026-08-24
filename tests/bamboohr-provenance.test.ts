import assert from "node:assert/strict";
import test from "node:test";
import { extractPublishedBusinessEmails, validateBambooHrEvidenceUrl } from "../lib/scout/contact-extraction.ts";

test("BambooHR provenance accepts only the exact registered tenant and posting id", () => {
  assert.equal(
    validateBambooHrEvidenceUrl("https://acme.bamboohr.com/careers/42", "acme", "42").href,
    "https://acme.bamboohr.com/careers/42",
  );
  assert.throws(() => validateBambooHrEvidenceUrl("https://other.bamboohr.com/careers/42", "acme", "42"), /does not match/);
  assert.throws(() => validateBambooHrEvidenceUrl("https://acme.bamboohr.com/careers/99", "acme", "42"), /does not match/);
  assert.throws(() => validateBambooHrEvidenceUrl("https://acme.bamboohr.com/careers/42?source=search", "acme", "42"), /exact HTTPS job URL/);
  assert.throws(() => validateBambooHrEvidenceUrl("https://acme.bamboohr.com/careers/42/detail", "acme", "42"), /does not match/);
});

test("BambooHR snapshot contact extraction remains published-evidence only", () => {
  const result = extractPublishedBusinessEmails({
    provider: "bamboohr",
    persistedContent: "For recruiting questions email careers@acme.com. Personal address example@gmail.com is not a business contact.",
    evidenceUrl: "https://acme.bamboohr.com/careers/42",
    boardToken: "acme",
    externalId: "42",
    companyDomain: "acme.com",
    now: () => "2026-08-24T15:00:00.000Z",
  });

  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].email, "careers@acme.com");
  assert.equal(result.contacts[0].sourceUrl, "https://acme.bamboohr.com/careers/42");
  assert.equal(result.contacts[0].sourceType, "official_job_posting");
  assert.equal(result.contacts[0].reviewState, "needs_review");
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].email, "example@gmail.com");
});
