import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_RESEARCH_CAPABILITIES, researchPublishedCompanyContacts } from "../agent/contact-research.ts";

function fakeFetch(pages: Record<string, string>) {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url.href);
    const html = pages[url.href];
    return html === undefined
      ? new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })
      : new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  return { calls, fetcher };
}

test("contact research preserves exact recruiting/business evidence on the bounded first-party crawl", async () => {
  const { calls, fetcher } = fakeFetch({
    "https://acme.example/": '<a href="/careers">Careers</a><a href="https://evil.example/contact">Elsewhere</a> info@acme.example support@acme.example',
    "https://acme.example/careers": '<p>Internship questions: careers@acme.example</p><p>University recruiter Priya: priya.shah@acme.example</p><a href="/team">Our team</a>',
    "https://acme.example/jobs": "",
    "https://acme.example/contact": "Press: media@acme.example",
    "https://acme.example/contact-us": "",
    "https://acme.example/team": "People team: talent@acme.example. Engineering lead: john.doe@acme.example",
  });
  const result = await researchPublishedCompanyContacts({ companyDomain: "acme.example", jobSnapshotId: "snapshot-1", fetcher });
  const emails = result.candidates.map((candidate) => candidate.email).sort();
  assert.deepEqual(emails, ["careers@acme.example", "info@acme.example", "priya.shah@acme.example", "talent@acme.example"]);
  assert.ok(result.candidates.find((candidate) => candidate.email === "careers@acme.example")?.excerpt.includes("Internship questions"));
  assert.equal(result.candidates.find((candidate) => candidate.email === "careers@acme.example")?.sourceType, "official_careers");
  assert.equal(calls.some((url) => url.includes("evil.example")), false);
});

test("contact research starts from a verified same-domain careers subdomain when supplied", async () => {
  const { calls, fetcher } = fakeFetch({
    "https://careers.acme.example/openings": "Recruiting: internships@acme.example",
    "https://acme.example/": "",
    "https://acme.example/careers": "",
    "https://acme.example/jobs": "",
    "https://acme.example/contact": "",
    "https://acme.example/contact-us": "",
  });
  const result = await researchPublishedCompanyContacts({
    companyDomain: "acme.example",
    jobSnapshotId: "snapshot-1",
    careersUrl: "https://careers.acme.example/openings",
    fetcher,
  });
  assert.equal(calls[0], "https://careers.acme.example/openings");
  assert.equal(result.candidates[0]?.email, "internships@acme.example");
  assert.equal(result.candidates[0]?.sourceType, "official_careers");
});

test("contact research rejects an off-domain careers seed instead of following it", async () => {
  const { fetcher } = fakeFetch({});
  await assert.rejects(() => researchPublishedCompanyContacts({
    companyDomain: "acme.example",
    jobSnapshotId: "snapshot-1",
    careersUrl: "https://evil.example/careers",
    fetcher,
  }), /escaped the registered company domain/);
});

test("v1 contact research does not fetch arbitrary third-party search-result pages", async () => {
  const { calls, fetcher } = fakeFetch({
    "https://acme.example/": "Careers: careers@acme.example",
    "https://acme.example/careers": "",
    "https://acme.example/jobs": "",
    "https://acme.example/contact": "",
    "https://acme.example/contact-us": "",
  });
  let searchCalls = 0;
  const searchProvider = {
    provider: "test-search",
    async searchFixedQuery() {
      searchCalls += 1;
      return [{ url: "https://attacker.example/recruiting", title: "Acme recruiting", description: "Recruiting contact private@attacker.example" }];
    },
  };
  const result = await researchPublishedCompanyContacts({ companyDomain: "acme.example", jobSnapshotId: "snapshot-1", fetcher, searchProvider });
  assert.equal(searchCalls, 0);
  assert.equal(result.publicPagesAttempted, 0);
  assert.equal(result.searchQueriesAttempted, 0);
  assert.equal(calls.some((url) => url.includes("attacker.example")), false);
  assert.deepEqual(result.candidates.map((candidate) => candidate.email), ["careers@acme.example"]);
});

test("contact research never guesses addresses and keeps scraping boundaries explicit", async () => {
  const { fetcher } = fakeFetch({ "https://acme.example/": "Talk to our recruiting team. No email is published." });
  const result = await researchPublishedCompanyContacts({ companyDomain: "acme.example", jobSnapshotId: "snapshot-1", fetcher });
  assert.deepEqual(result.candidates, []);
  await assert.rejects(() => researchPublishedCompanyContacts({ companyDomain: "localhost", jobSnapshotId: "snapshot-1", fetcher }), /domain is invalid/);
  await assert.rejects(() => researchPublishedCompanyContacts({ companyDomain: "10.0.0.1", jobSnapshotId: "snapshot-1", fetcher }), /domain is invalid/);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.officialCompanyPagesFirst, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.broaderPublicRecruitingEvidence, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.thirdPartyPublicPageFetch, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.companyDomainBoundFirstParty, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.verifiedCareersSeedSupported, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.namedBusinessMailboxRequiresRecruitingContext, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.guessEmail, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.linkedinScrape, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.dataBrokerLookup, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.personalDataHarvest, false);
  assert.equal((CONTACT_RESEARCH_CAPABILITIES as Record<string, unknown>).sendEmail, undefined);
});
