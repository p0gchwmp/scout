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

test("contact research stays on official company pages and preserves exact published evidence", async () => {
  const { calls, fetcher } = fakeFetch({
    "https://acme.example/": '<a href="/careers">Careers</a><a href="https://evil.example/contact">Elsewhere</a> support@acme.example',
    "https://acme.example/careers": '<p>Internship questions: careers@acme.example</p><a href="/team">Our team</a>',
    "https://acme.example/jobs": "",
    "https://acme.example/contact": "Press: media@acme.example",
    "https://acme.example/contact-us": "",
    "https://acme.example/team": "People team: talent@acme.example",
  });
  const result = await researchPublishedCompanyContacts({ companyDomain: "acme.example", jobSnapshotId: "snapshot-1", fetcher });
  const emails = result.candidates.map((candidate) => candidate.email).sort();
  assert.deepEqual(emails, ["careers@acme.example", "media@acme.example", "support@acme.example", "talent@acme.example"]);
  assert.ok(result.candidates.find((candidate) => candidate.email === "careers@acme.example")?.excerpt.includes("Internship questions"));
  assert.equal(result.candidates.find((candidate) => candidate.email === "careers@acme.example")?.sourceType, "official_careers");
  assert.equal(calls.some((url) => url.includes("evil.example")), false);
});

test("contact research never guesses addresses and rejects private or malformed company domains", async () => {
  const { fetcher } = fakeFetch({ "https://acme.example/": "Talk to our recruiting team. No email is published." });
  const result = await researchPublishedCompanyContacts({ companyDomain: "acme.example", jobSnapshotId: "snapshot-1", fetcher });
  assert.deepEqual(result.candidates, []);
  await assert.rejects(() => researchPublishedCompanyContacts({ companyDomain: "localhost", jobSnapshotId: "snapshot-1", fetcher }), /domain is invalid/);
  await assert.rejects(() => researchPublishedCompanyContacts({ companyDomain: "10.0.0.1", jobSnapshotId: "snapshot-1", fetcher }), /domain is invalid/);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.guessEmail, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.linkedinScrape, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.personalDataHarvest, false);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.sendEmail, false);
});
