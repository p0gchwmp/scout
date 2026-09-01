import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_RESEARCH_CAPABILITIES, researchPublishedCompanyContacts } from "../agent/contact-research.ts";
import { assessPublishedContact } from "../lib/scout/contact-intelligence.ts";

function fakeFetch(pages: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    fetcher: async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push(url.href);
      const body = pages[url.href];
      return body === undefined
        ? new Response("missing", { status: 404, headers: { "content-type": "text/plain" } })
        : new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    },
  };
}

test("M25 records richer exact provenance while remaining company-domain bound", async () => {
  const { calls, fetcher } = fakeFetch({
    "https://acme.example/": '<a href="/events/campus-hiring">Campus event</a><a href="/press/graduate-program">Press</a><a href="/team">Team</a><a href="https://evil.example/events/acme">External event</a>',
    "https://acme.example/events": '<a href="/events/campus-hiring">Campus hiring</a>',
    "https://acme.example/events/campus-hiring": "Campus recruiting questions: campus@acme.example",
    "https://acme.example/press": '<a href="/press/graduate-program">Graduate program release</a>',
    "https://acme.example/press/graduate-program": "For internship recruiting contact careers@acme.example. Media: press@acme.example",
    "https://acme.example/team": "Talent team: talent@acme.example. Engineering: jane.doe@acme.example",
  });
  const result = await researchPublishedCompanyContacts({ companyDomain: "acme.example", jobSnapshotId: "snapshot-25", fetcher });
  const byEmail = new Map(result.candidates.map((item) => [item.email, item]));
  assert.equal(byEmail.get("campus@acme.example")?.sourceType, "official_event");
  assert.equal(byEmail.get("careers@acme.example")?.sourceType, "official_press");
  assert.equal(byEmail.get("talent@acme.example")?.sourceType, "official_team");
  assert.equal(byEmail.has("press@acme.example"), false);
  assert.equal(byEmail.has("jane.doe@acme.example"), false);
  assert.equal(calls.some((url) => url.includes("evil.example")), false);
});

test("M25 still never consumes third-party public search results", async () => {
  let searchCalls = 0;
  const { calls, fetcher } = fakeFetch({});
  const result = await researchPublishedCompanyContacts({
    companyDomain: "acme.example",
    jobSnapshotId: "snapshot-25b",
    fetcher,
    searchProvider: { provider: "test", async searchFixedQuery() { searchCalls += 1; return [{ url: "https://linkedin.com/in/x", title: "x", description: "x" }]; } },
  });
  assert.equal(searchCalls, 0);
  assert.equal(result.publicPagesAttempted, 0);
  assert.equal(result.searchQueriesAttempted, 0);
  assert.equal(calls.some((url) => url.includes("linkedin.com")), false);
});

test("M25 provenance types improve ranking without overriding relevance checks", () => {
  const job = assessPublishedContact({ email: "careers@acme.example", excerpt: "Recruiting", sourceType: "official_job_posting", sourceContext: "first_party" });
  const event = assessPublishedContact({ email: "campus@acme.example", excerpt: "Campus recruiting", sourceType: "official_event", sourceContext: "first_party" });
  const generic = assessPublishedContact({ email: "info@acme.example", excerpt: "General questions", sourceType: "official_company", sourceContext: "first_party" });
  assert.ok(job.score > event.score);
  assert.ok(event.score > generic.score);
  assert.equal(job.signal, "recruiting");
});

test("M25 capabilities expand official provenance only, not scraping capability", () => {
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.registeredOfficialSourceTypes, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.officialEventPages, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.officialPressPages, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.officialTeamPages, true);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.thirdPartyPublicPageFetch, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.guessEmail, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.linkedinScrape, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.dataBrokerLookup, false);
});
