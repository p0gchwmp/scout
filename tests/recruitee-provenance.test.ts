import assert from "node:assert/strict";
import test from "node:test";
import { extractPublishedBusinessEmails, validateRecruiteeEvidenceUrl } from "../lib/scout/contact-extraction.ts";

test("Recruitee provenance accepts only the exact registered tenant and offer slug", () => {
  assert.equal(
    validateRecruiteeEvidenceUrl("https://acme.recruitee.com/o/product-intern", "acme", "product-intern").href,
    "https://acme.recruitee.com/o/product-intern",
  );
  assert.throws(() => validateRecruiteeEvidenceUrl("https://other.recruitee.com/o/product-intern", "acme", "product-intern"), /does not match/);
  assert.throws(() => validateRecruiteeEvidenceUrl("https://acme.recruitee.com/o/finance-intern", "acme", "product-intern"), /does not match/);
  assert.throws(() => validateRecruiteeEvidenceUrl("https://acme.recruitee.com/o/product-intern?source=search", "acme", "product-intern"), /exact HTTPS job URL/);
  assert.throws(() => validateRecruiteeEvidenceUrl("https://jobs.acme.com/o/product-intern", "acme", "product-intern"), /does not match/);
});

test("Recruitee snapshot contact extraction remains published-evidence only", () => {
  const result = extractPublishedBusinessEmails({
    provider: "recruitee",
    persistedContent: "For recruiting questions email careers@acme.com. Personal address example@gmail.com is not a business contact.",
    evidenceUrl: "https://acme.recruitee.com/o/product-intern",
    boardToken: "acme",
    externalId: "product-intern",
    companyDomain: "acme.com",
    now: () => "2026-08-24T15:00:00.000Z",
  });

  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].email, "careers@acme.com");
  assert.equal(result.contacts[0].sourceUrl, "https://acme.recruitee.com/o/product-intern");
  assert.equal(result.contacts[0].sourceType, "official_job_posting");
  assert.equal(result.contacts[0].reviewState, "needs_review");
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].email, "example@gmail.com");
});
