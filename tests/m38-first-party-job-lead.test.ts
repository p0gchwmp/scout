import assert from "node:assert/strict";
import test from "node:test";
import { extractFirstPartyJobLeads, FIRST_PARTY_JOB_LEAD_CAPABILITIES } from "../lib/scout/first-party-job-lead.ts";

const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [{
    "@type": "JobPosting",
    title: "Product Operations Intern",
    description: "<p>Support product operations, research and documentation.</p>",
    datePosted: "2026-08-30",
    hiringOrganization: { "@type": "Organization", name: "Example Health" },
    jobLocation: { "@type": "Place", address: { addressLocality: "Bengaluru", addressRegion: "Karnataka", addressCountry: "India" } },
  }],
})}</script></head><body>careers</body></html>`;

test("M38 parses first-party JobPosting JSON-LD only as an unresolved lead", () => {
  const leads = extractFirstPartyJobLeads({
    html,
    canonicalUrl: "https://careers.examplehealth.com/jobs/product-ops-intern",
    companyDomain: "examplehealth.com",
    companyName: "Example Health",
  });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].trust, "lead_only");
  assert.equal(leads[0].requiresOfficialResolution, true);
  assert.equal(leads[0].title, "Product Operations Intern");
  assert.equal(leads[0].location, "Bengaluru, Karnataka, India");
  assert.equal(leads[0].company, "Example Health");
  assert.equal(leads[0].postedAt, "2026-08-30T00:00:00.000Z");
  assert.equal(FIRST_PARTY_JOB_LEAD_CAPABILITIES.arbitraryUrlFetch, false);
  assert.equal(FIRST_PARTY_JOB_LEAD_CAPABILITIES.extractContacts, false);
  assert.equal(FIRST_PARTY_JOB_LEAD_CAPABILITIES.inferEmails, false);
});

test("M38 rejects off-domain, non-HTTPS and credentialed first-party pages", () => {
  for (const canonicalUrl of [
    "https://evil.example/jobs/1",
    "http://careers.examplehealth.com/jobs/1",
    "https://user:pass@careers.examplehealth.com/jobs/1",
  ]) {
    assert.throws(() => extractFirstPartyJobLeads({ html, canonicalUrl, companyDomain: "examplehealth.com", companyName: "Example Health" }));
  }
});

test("M38 ignores broken JSON-LD and non-job structured data", () => {
  const mixed = `<script type="application/ld+json">not-json</script><script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Example" })}</script>`;
  assert.deepEqual(extractFirstPartyJobLeads({ html: mixed, canonicalUrl: "https://examplehealth.com/careers", companyDomain: "examplehealth.com", companyName: "Example Health" }), []);
});
