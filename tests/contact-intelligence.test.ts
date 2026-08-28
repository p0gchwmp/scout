import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assessPublishedContact,
  rankPublishedContacts,
  validateLinkedInRecruiterClueUrl,
} from "../lib/scout/contact-intelligence.ts";

test("contact intelligence prioritizes explicitly published recruiting addresses without auto-accepting them", () => {
  const recruiting = assessPublishedContact({
    email: "careers@example.com",
    sourceUrl: "https://example.com/careers",
    sourceType: "official_careers",
    excerpt: "For internships and recruiting questions contact careers@example.com.",
  });
  assert.equal(recruiting.signal, "recruiting");
  assert.ok(recruiting.score >= 70);

  const privacy = assessPublishedContact({
    email: "privacy@example.com",
    sourceUrl: "https://example.com/privacy",
    sourceType: "official_company",
    excerpt: "Privacy questions: privacy@example.com",
  });
  assert.equal(privacy.signal, "low_relevance");
  assert.ok(privacy.score < recruiting.score);
});

test("manual recruiter clues only rank already-published evidence", () => {
  const contacts = [
    { email: "hello@example.com", excerpt: "General enquiries", sourceType: "official_contact" },
    { email: "jane@example.com", excerpt: "Jane Doe leads campus recruiting and talent acquisition", sourceType: "official_company" },
  ];
  const ranked = rankPublishedContacts(contacts, { name: "Jane Doe", role: "Campus Recruiting" });
  assert.equal(ranked[0].email, "jane@example.com");
});

test("LinkedIn clue accepts only normal profile URLs and never arbitrary hosts", () => {
  assert.equal(validateLinkedInRecruiterClueUrl("https://www.linkedin.com/in/jane-doe/"), "https://www.linkedin.com/in/jane-doe/");
  assert.equal(validateLinkedInRecruiterClueUrl("https://evil.example/in/jane-doe"), null);
  assert.equal(validateLinkedInRecruiterClueUrl("https://linkedin.com/company/example"), null);
  assert.equal(validateLinkedInRecruiterClueUrl("javascript:alert(1)"), null);
});

test("contact research is bounded across first-party and public-web evidence while blocking private/broker scraping", async () => {
  const source = await readFile(new URL("../agent/contact-research.ts", import.meta.url), "utf8");
  assert.match(source, /MAX_FIRST_PARTY_PAGES = 8/);
  assert.match(source, /MAX_PUBLIC_PAGES = 12/);
  assert.match(source, /officialCompanyPagesFirst: true/);
  assert.match(source, /broaderPublicRecruitingEvidence: true/);
  assert.match(source, /companyDomainBoundFirstParty: true/);
  assert.match(source, /linkedinScrape: false/);
  assert.match(source, /dataBrokerLookup: false/);
  assert.match(source, /guessEmail: false/);
  assert.match(source, /linkedin\\\.com/);
  assert.match(source, /apollo\\\.io/);
  assert.match(source, /hunter\\\.io/);
  assert.doesNotMatch(source, /fetch\([^\n]*linkedin\.com/i);
});

test("accepted-contact outreach degrades to deterministic approved-claim drafting when cloud AI is unavailable", async () => {
  const source = await readFile(new URL("../app/api/agent/draft-outreach/auto/route.ts", import.meta.url), "utf8");
  assert.match(source, /renderOutreachDraft/);
  assert.match(source, /deterministic-fallback/);
  assert.match(source, /reviewState, "accepted"/);
  assert.match(source, /sendEmail: false/);
  assert.match(source, /submitApplication: false/);
});

test("contact intelligence page keeps LinkedIn clues browser-only and uses official research route", async () => {
  const source = await readFile(new URL("../app/contacts/contact-intelligence-client.tsx", import.meta.url), "utf8");
  assert.match(source, /LinkedIn clue/i);
  assert.match(source, /browser-only/i);
  assert.match(source, /\/api\/agent\/research-contacts/);
  assert.doesNotMatch(source, /body: JSON\.stringify\(\{[^}]*linkedinUrl/s);
  assert.match(source, /\/api\/agent\/draft-outreach\/auto/);
  assert.match(source, /Review Queue/);
});
