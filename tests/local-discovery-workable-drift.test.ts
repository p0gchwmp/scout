import assert from "node:assert/strict";
import test from "node:test";
import { discoverLocalSource } from "../scripts/scout-local-discovery.mjs";

const source = {
  provider: "workable",
  slug: "2070health",
  company: "2070Health",
  companyDomain: "2070health.com",
  sourceUrl: "https://apply.workable.com/2070health/",
  focus: "India health-tech, D2C operations, GTM, business",
};

async function withFetchMock(mock: typeof fetch, operation: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await operation(); }
  finally { globalThis.fetch = original; }
}

test("local Workable discovery prefers the current exact job shortlink over application_url", async () => {
  await withFetchMock(async () => Response.json({
    name: "2070Health",
    jobs: [{
      shortcode: "9236226E92",
      shortlink: "https://apply.workable.com/j/9236226E92",
      application_url: "https://apply.workable.com/2070health/j/9236226E92/apply/",
      title: "Go-To-Market Intern",
      description: "Internship supporting D2C operations.",
      city: "Gurugram",
      country: "India",
      workplace_type: "on_site",
    }],
  }), async () => {
    const jobs = await discoverLocalSource(source);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "9236226E92");
    assert.equal(jobs[0].canonicalUrl, "https://apply.workable.com/j/9236226E92");
  });
});

test("local Workable discovery retains the exact legacy slugged job-page form when no shortlink is present", async () => {
  await withFetchMock(async () => Response.json({
    name: "2070Health",
    jobs: [{
      shortcode: "9236226E92",
      application_url: "https://apply.workable.com/2070health/j/9236226E92/",
      title: "Operations Intern",
      description: "Internship supporting operations.",
    }],
  }), async () => {
    const jobs = await discoverLocalSource(source);
    assert.equal(jobs[0].canonicalUrl, "https://apply.workable.com/2070health/j/9236226E92/");
  });
});
