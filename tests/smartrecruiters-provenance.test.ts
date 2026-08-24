import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPublishedBusinessEmails,
  validateSmartRecruitersEvidenceUrl,
} from "../lib/scout/contact-extraction.ts";

test("SmartRecruiters evidence binds company identifier and posting id", () => {
  assert.equal(
    validateSmartRecruitersEvidenceUrl(
      "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
      "acme",
      "74944235",
    ).href,
    "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
  );

  for (const [url, company, postingId] of [
    ["https://jobs.smartrecruiters.com/other/74944235-product-intern", "acme", "74944235"],
    ["https://jobs.smartrecruiters.com/acme/99999999-product-intern", "acme", "74944235"],
    ["https://jobs.smartrecruiters.com/acme/74944235-product-intern?oga=true", "acme", "74944235"],
    ["https://careers.smartrecruiters.com/acme/74944235-product-intern", "acme", "74944235"],
    ["http://jobs.smartrecruiters.com/acme/74944235-product-intern", "acme", "74944235"],
  ] as const) {
    assert.throws(() => validateSmartRecruitersEvidenceUrl(url, company, postingId));
  }
});

test("SmartRecruiters contact extraction only uses the exact persisted public posting", () => {
  const result = extractPublishedBusinessEmails({
    provider: "smartrecruiters",
    persistedContent: "For recruiting questions email talent@acme.com. Personal contact: test@gmail.com.",
    evidenceUrl: "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
    boardToken: "acme",
    externalId: "74944235",
    companyDomain: "acme.com",
    now: () => "2026-08-24T14:00:00.000Z",
  });

  assert.equal(result.contacts.length, 1);
  assert.deepEqual(result.contacts[0], {
    email: "talent@acme.com",
    sourceUrl: "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
    excerpt: "For recruiting questions email talent@acme.com. Personal contact: test@gmail.com.",
    sourceType: "official_job_posting",
    extractedAt: "2026-08-24T14:00:00.000Z",
    suitability: "high",
    suitabilityReason: "Published first-party recruiting address",
    reviewState: "needs_review",
  });
  assert.deepEqual(result.rejections, [{
    email: "test@gmail.com",
    sourceUrl: "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
    reason: "consumer-domain",
  }]);
});
