import assert from "node:assert/strict";
import test from "node:test";
import { RECRUITEE_PUBLIC_JSON_CUTOFF, RecruiteePublicCareersAdapter } from "../lib/recruitee-adapter.ts";

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

test("Recruitee adapter reads the public careers feed without auth or candidate writes", async () => {
  const calls: string[] = [];
  const adapter = new RecruiteePublicCareersAdapter(() => Date.parse("2026-08-24T15:00:00.000Z"));
  const jobs = await withFetch((async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.href);
    assert.equal(url.href, "https://acme.recruitee.com/api/offers");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("x-careers-sites-token"), false);
    return Response.json({
      offers: [{
        slug: "product-intern",
        status: "published",
        kind: "job",
        title: "Product Intern",
        description: "<p>Work with product and operations.</p>",
        requirements: "<p>Current student preferred.</p>",
        company_name: "Acme Labs",
        location: { city: "Bengaluru", state: "Karnataka", country: "India" },
        hybrid: true,
        careers_url: "https://acme.recruitee.com/o/product-intern",
        careers_apply_url: "https://acme.recruitee.com/o/product-intern/c/new",
        published_at: "2026-08-23T10:00:00Z",
      }],
    });
  }) as typeof fetch, () => adapter.discover("acme"));

  assert.deepEqual(calls, ["https://acme.recruitee.com/api/offers"]);
  assert.deepEqual(jobs, [{
    source: "recruitee",
    externalId: "product-intern",
    canonicalUrl: "https://acme.recruitee.com/o/product-intern",
    company: "Acme Labs",
    title: "Product Intern",
    description: "Work with product and operations.\n\nCurrent student preferred.",
    location: "Bengaluru, Karnataka, India",
    workplaceType: "hybrid",
    postedAt: "2026-08-23T10:00:00Z",
  }]);
  assert.equal(adapter.capabilities.discovery, true);
  assert.equal(adapter.capabilities.submission, false);
  assert.equal(adapter.capabilities.careersApiToken, false);
  assert.equal(adapter.capabilities.candidateCreation, false);
  assert.equal(adapter.capabilities.publicJsonAccessSunset, RECRUITEE_PUBLIC_JSON_CUTOFF);
});

test("Recruitee adapter fails closed at the announced careers-token deadline before networking", async () => {
  let fetches = 0;
  const adapter = new RecruiteePublicCareersAdapter(() => Date.parse(RECRUITEE_PUBLIC_JSON_CUTOFF));
  await withFetch((async () => {
    fetches += 1;
    throw new Error("fetch should not run after cutoff");
  }) as typeof fetch, async () => {
    await assert.rejects(() => adapter.discover("acme"), /requires a fresh safety review/);
  });
  assert.equal(fetches, 0);
});

test("Recruitee adapter rejects a careers URL for another tenant", async () => {
  const adapter = new RecruiteePublicCareersAdapter(() => Date.parse("2026-08-24T15:00:00.000Z"));
  await withFetch((async () => Response.json({
    offers: [{
      slug: "product-intern",
      status: "published",
      kind: "job",
      title: "Product Intern",
      careers_url: "https://other.recruitee.com/o/product-intern",
    }],
  })) as typeof fetch, async () => {
    await assert.rejects(() => adapter.discoverPosting("acme", "product-intern"), /does not match the requested tenant and offer slug/);
  });
});
