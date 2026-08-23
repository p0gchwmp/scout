import assert from "node:assert/strict";
import test from "node:test";
import { LEAD_RESOLUTION_CAPABILITIES, resolveControlledLead } from "../lib/scout/lead-resolution.ts";

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

test("lead resolution only fetches controlled Greenhouse postings and preserves immutable inputs", async () => {
  assert.equal(LEAD_RESOLUTION_CAPABILITIES.controlledSourcesOnly, true);
  assert.equal(LEAD_RESOLUTION_CAPABILITIES.arbitraryUrlFetch, false);
  assert.equal(LEAD_RESOLUTION_CAPABILITIES.lever, false);
  assert.equal(LEAD_RESOLUTION_CAPABILITIES.submit, false);
  assert.equal(LEAD_RESOLUTION_CAPABILITIES.send, false);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.href, "https://boards-api.greenhouse.io/v1/boards/fourkites/jobs?content=true");
    return Response.json({ jobs: [{
      id: 123,
      absolute_url: "https://job-boards.greenhouse.io/fourkites/jobs/123",
      title: "Product Operations Intern",
      content: "Work with product operations in Bengaluru. careers@fourkites.com",
      location: { name: "Bengaluru, India" },
      updated_at: "2026-08-24T00:00:00Z",
    }] });
  }) as typeof fetch;

  const result = await resolveControlledLead("https://job-boards.greenhouse.io/fourkites/jobs/123");
  assert.equal(result.source.boardToken, "fourkites");
  assert.equal(result.source.companyDomain, "fourkites.com");
  assert.equal(result.snapshot.externalId, "123");
  assert.equal(result.snapshot.company, "FourKites");
  assert.match(result.snapshot.description, /careers@fourkites\.com/);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test("lead resolution refuses arbitrary and unsupported URLs without fetching", async () => {
  let fetches = 0;
  globalThis.fetch = (async () => { fetches += 1; throw new Error("must not fetch"); }) as typeof fetch;
  await assert.rejects(() => resolveControlledLead("https://example.com/jobs/123"), /not supported/i);
  await assert.rejects(() => resolveControlledLead("https://job-boards.greenhouse.io/notregistered/jobs/123"), /controlled discovery source/i);
  await assert.rejects(() => resolveControlledLead("https://jobs.lever.co/paytm/abc"), /not supported/i);
  assert.equal(fetches, 0);
});
