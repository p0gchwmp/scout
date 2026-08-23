import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROLLED_DISCOVERY_SOURCES,
  LEAD_DISCOVERY_CAPABILITIES,
  discoverControlledInternships,
} from "../lib/scout/lead-discovery.ts";

const originalFetch = globalThis.fetch;

test.after(() => { globalThis.fetch = originalFetch; });

test("lead discovery uses only a controlled public ATS catalog", () => {
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.controlledSourcesOnly, true);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.arbitraryUrlFetch, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.linkedinScrape, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.submit, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.send, false);
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.length >= 8);
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.every((source) => source.provider === "greenhouse" || source.provider === "lever"));
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.every((source) => /^https:\/\/(job-boards\.greenhouse\.io|jobs\.lever\.co)\//.test(source.sourceUrl)));
});

test("controlled discovery filters to India/remote internship leads and preserves official URLs", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "boards-api.greenhouse.io") {
      const slug = url.pathname.split("/")[3];
      return Response.json({ jobs: [
        { id: `${slug}-1`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/123`, title: "Product Operations Intern", content: "Internship in Bengaluru, India", location: { name: "Bengaluru, India" }, updated_at: "2026-08-24T00:00:00Z" },
        { id: `${slug}-2`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/456`, title: "Senior Engineer", content: "India", location: { name: "Bengaluru, India" } },
        { id: `${slug}-3`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/789`, title: "Marketing Intern", content: "US only", location: { name: "New York, NY" } },
      ]});
    }
    if (url.hostname === "api.lever.co") {
      const slug = url.pathname.split("/").pop();
      return Response.json([
        { id: `${slug}-1`, hostedUrl: `https://jobs.lever.co/${slug}/abc`, text: "Revenue Operations Intern", descriptionPlain: "Remote India internship", categories: { location: "Remote, India" }, workplaceType: "remote" },
        { id: `${slug}-2`, hostedUrl: `https://jobs.lever.co/${slug}/def`, text: "Finance Manager", descriptionPlain: "Mumbai", categories: { location: "Mumbai, India" }, workplaceType: "on-site" },
      ]);
    }
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;

  const result = await discoverControlledInternships();
  assert.equal(result.failures.length, 0);
  assert.equal(result.leads.length, CONTROLLED_DISCOVERY_SOURCES.length);
  assert.ok(result.leads.every((lead) => /Intern/i.test(lead.title)));
  assert.ok(result.leads.every((lead) => lead.canonicalUrl.startsWith("https://")));
  assert.ok(result.leads.every((lead) => lead.snapshotRequired));
});
