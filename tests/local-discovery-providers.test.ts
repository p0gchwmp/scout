import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  discoverLocalSource,
  LOCAL_DISCOVERY_PROVIDERS,
  stableLocalDiscoveryFailure,
} from "../scripts/scout-local-discovery.mjs";

const baseSource = {
  company: "Example",
  companyDomain: "example.com",
  sourceUrl: "https://example.com/careers",
  focus: "analytics, product, operations",
};

async function withFetchMock(mock: typeof fetch, operation: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await operation(); }
  finally { globalThis.fetch = original; }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("local discovery explicitly supports five controlled ATS providers", () => {
  assert.deepEqual(LOCAL_DISCOVERY_PROVIDERS, ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"]);
  assert.equal(LOCAL_DISCOVERY_PROVIDERS.includes("workday"), false);
  assert.equal(LOCAL_DISCOVERY_PROVIDERS.includes("bamboohr"), false);
});

test("Ashby public board payload normalizes into Scout lead evidence", async () => {
  await withFetchMock(async (input) => {
    assert.match(String(input), /^https:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/flagright\.com/);
    return jsonResponse({ apiVersion: "1", jobs: [{
      id: "ignored",
      isListed: true,
      jobUrl: "https://jobs.ashbyhq.com/flagright.com/cdc0b71f-fb24-49bf-babe-de63bdaacb7e",
      title: "Product Operations Intern",
      descriptionPlain: "Support implementations, workflows and QA.",
      location: "Remote",
      workplaceType: "Remote",
      publishedAt: "2026-08-20T00:00:00Z",
    }] });
  }, async () => {
    const jobs = await discoverLocalSource({ ...baseSource, provider: "ashby", slug: "flagright.com" });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].provider, "ashby");
    assert.equal(jobs[0].externalId, "cdc0b71f-fb24-49bf-babe-de63bdaacb7e");
    assert.equal(jobs[0].workplaceType, "remote");
    assert.match(jobs[0].description, /implementations/i);
  });
});

test("Workable public account payload normalizes only public job fields", async () => {
  await withFetchMock(async (input) => {
    assert.equal(String(input), "https://www.workable.com/api/accounts/2070health?details=true");
    return jsonResponse({ name: "2070Health", jobs: [{
      shortcode: "9236226E92",
      application_url: "https://apply.workable.com/2070health/j/9236226E92/",
      title: "Go-To-Market Intern",
      description: "<p>Run D2C store operations and catalogue workflows.</p>",
      city: "Gurugram",
      country: "India",
      workplace_type: "on_site",
      published_on: "2026-08-22",
    }] });
  }, async () => {
    const jobs = await discoverLocalSource({ ...baseSource, provider: "workable", slug: "2070health" });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "9236226E92");
    assert.equal(jobs[0].location, "Gurugram, India");
    assert.equal(jobs[0].workplaceType, "on-site");
    assert.equal(jobs[0].description.includes("<p>"), false);
  });
});

test("SmartRecruiters filters the public list before fetching posting details", async () => {
  const calls: string[] = [];
  await withFetchMock(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/postings?")) {
      return jsonResponse({ totalFound: 2, content: [
        { id: "744000108155586", name: "Business Analyst Intern" },
        { id: "744000999999999", name: "Senior Software Architect" },
      ] });
    }
    assert.match(url, /\/postings\/744000108155586$/);
    return jsonResponse({
      id: "744000108155586",
      active: true,
      postingUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000108155586--bd-business-analyst-intern",
      name: "Business Analyst Intern",
      company: { identifier: "BoschGroup", name: "Bosch Group" },
      location: { city: "Ho Chi Minh City", country: "VN", remote: false },
      releasedDate: "2026-08-01T00:00:00Z",
      jobAd: { sections: {
        jobDescription: { text: "<p>Support workflow analysis and product documentation.</p>" },
        qualifications: { text: "<p>Student internship.</p>" },
      } },
    });
  }, async () => {
    const jobs = await discoverLocalSource({ ...baseSource, provider: "smartrecruiters", slug: "BoschGroup" });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].provider, "smartrecruiters");
    assert.match(jobs[0].description, /workflow analysis/i);
    assert.equal(calls.length, 2, "Scout should not fetch the non-intern senior posting detail");
  });
});

test("expanded catalog contains the verified non-Greenhouse/Lever activation set", async () => {
  const catalog = JSON.parse(await readFile(new URL("../config/discovery-sources.json", import.meta.url), "utf8")) as Array<{ provider: string; slug: string; company: string }>;
  assert.equal(catalog.length, 31);
  assert.ok(catalog.some((item) => item.provider === "ashby" && item.slug === "flagright.com" && item.company === "Flagright"));
  assert.ok(catalog.some((item) => item.provider === "workable" && item.slug === "2070health" && item.company === "2070Health"));
  assert.ok(catalog.some((item) => item.provider === "smartrecruiters" && item.slug === "BoschGroup" && item.company === "Bosch Group"));
  assert.ok(catalog.some((item) => item.provider === "lever" && item.slug === "dnb" && item.company === "Dun & Bradstreet"));
  assert.ok(catalog.some((item) => item.provider === "lever" && item.slug === "fampay" && item.company === "Fam"));
  assert.ok(catalog.some((item) => item.provider === "ashby" && item.slug === "composio" && item.company === "Composio"));
  assert.ok(catalog.some((item) => item.provider === "ashby" && item.slug === "outmarket" && item.company === "Outmarket AI"));
  assert.ok(catalog.some((item) => item.provider === "ashby" && item.slug === "certifyos" && item.company === "CertifyOS"));
});

test("local provider failure mapping stays diagnostic and bounded", () => {
  assert.match(stableLocalDiscoveryFailure(new Error("HTTP 429")), /rate-limited.*bounded retry/i);
  assert.match(stableLocalDiscoveryFailure(new Error("invalid Ashby payload")), /adapter review/i);
  assert.match(stableLocalDiscoveryFailure(new Error("unsupported local discovery provider: workday")), /does not support/i);
});

test("local discovery module contains no apply, submit, contact or arbitrary-source capability", async () => {
  const source = await readFile(new URL("../scripts/scout-local-discovery.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /submitApplication|sendEmail|contact recruiter|linkedin/i);
  assert.doesNotMatch(source, /new URL\(source\.sourceUrl\)|fetch\(source\.sourceUrl/);
  assert.match(source, /api\.ashbyhq\.com/);
  assert.match(source, /www\.workable\.com\/api\/accounts/);
  assert.match(source, /api\.smartrecruiters\.com\/v1\/companies/);
});
