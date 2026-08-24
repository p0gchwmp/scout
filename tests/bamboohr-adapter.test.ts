import assert from "node:assert/strict";
import test from "node:test";
import { BambooHrPublicCareersAdapter } from "../lib/bamboohr-adapter.ts";

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

test("BambooHR adapter uses only public careers list/detail endpoints and never sends auth", async () => {
  const calls: string[] = [];
  const adapter = new BambooHrPublicCareersAdapter();
  const jobs = await withFetch((async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.href);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("authorization"), false);

    if (url.pathname === "/careers/list") {
      return Response.json({
        meta: { totalCount: 1 },
        result: [{ id: "42", jobOpeningName: "Product Intern", locationType: "2" }],
      });
    }

    assert.equal(url.pathname, "/careers/42/detail");
    return Response.json({
      result: {
        jobOpening: {
          jobOpeningName: "Product Intern",
          description: "<p>Work with product and operations. Email careers@acme.com.</p>",
          datePosted: "2026-08-23",
          locationType: "2",
          location: { city: "Bengaluru", state: "Karnataka", country: "India" },
          jobOpeningShareUrl: "https://acme.bamboohr.com/careers/42",
        },
      },
    });
  }) as typeof fetch, () => adapter.discover("acme"));

  assert.deepEqual(calls, [
    "https://acme.bamboohr.com/careers/list",
    "https://acme.bamboohr.com/careers/42/detail",
  ]);
  assert.deepEqual(jobs, [{
    source: "bamboohr",
    externalId: "42",
    canonicalUrl: "https://acme.bamboohr.com/careers/42",
    company: "acme",
    title: "Product Intern",
    description: "Work with product and operations. Email careers@acme.com.",
    location: "Bengaluru, Karnataka, India",
    workplaceType: "hybrid",
    postedAt: "2026-08-23",
  }]);
  assert.equal(adapter.capabilities.discovery, true);
  assert.equal(adapter.capabilities.submission, false);
  assert.equal(adapter.capabilities.employerApiCredentials, false);
  assert.equal(adapter.capabilities.tenantGuessing, false);
});

test("BambooHR adapter rejects a detail response that points at another tenant or job", async () => {
  await withFetch((async () => Response.json({
    result: { jobOpening: { jobOpeningName: "Product Intern", jobOpeningShareUrl: "https://other.bamboohr.com/careers/99" } },
  })) as typeof fetch, async () => {
    await assert.rejects(() => new BambooHrPublicCareersAdapter().discoverPosting("acme", "42"), /does not match the requested tenant and job id/);
  });
});
