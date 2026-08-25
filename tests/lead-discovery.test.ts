import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROLLED_DISCOVERY_SOURCES,
  LEAD_DISCOVERY_CAPABILITIES,
  discoverControlledInternships,
} from "../lib/scout/lead-discovery.ts";

const originalFetch = globalThis.fetch;

test.after(() => { globalThis.fetch = originalFetch; });

const SOURCE_HOSTS: Record<string, string> = {
  greenhouse: "job-boards.greenhouse.io",
  lever: "jobs.lever.co",
  ashby: "jobs.ashbyhq.com",
  workable: "apply.workable.com",
  smartrecruiters: "careers.smartrecruiters.com",
};

function providerForRequest(url: URL) {
  if (url.hostname === "boards-api.greenhouse.io") return "greenhouse";
  if (url.hostname === "api.lever.co") return "lever";
  if (url.hostname === "api.ashbyhq.com") return "ashby";
  if (url.hostname === "www.workable.com") return "workable";
  if (url.hostname === "api.smartrecruiters.com") return "smartrecruiters";
  throw new Error(`unexpected URL ${url}`);
}

function successfulProviderResponse(url: URL, options: { greenhouseGlobal?: boolean } = {}) {
  const provider = providerForRequest(url);
  if (provider === "greenhouse") {
    const slug = url.pathname.split("/")[3];
    return Response.json({ jobs: options.greenhouseGlobal ? [
      { id: `${slug}-1`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-1`, title: "Product Operations Intern", content: "Internship in Bengaluru, India", location: { name: "Bengaluru, India" }, updated_at: "2026-08-24T00:00:00Z" },
      { id: `${slug}-2`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-2`, title: "Senior Engineer", content: "India", location: { name: "Bengaluru, India" } },
      { id: `${slug}-3`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-3`, title: "Marketing Intern", content: "Internship in New York", location: { name: "New York, NY" }, updated_at: "2026-08-23T00:00:00Z" },
    ] : [{
      id: `${slug}-1`,
      absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-1`,
      title: "Product Operations Intern",
      content: "Internship in Bengaluru, India",
      location: { name: "Bengaluru, India" },
      updated_at: "2026-08-25T00:00:00Z",
    }] });
  }
  if (provider === "lever") {
    const slug = url.pathname.split("/").pop();
    return Response.json(options.greenhouseGlobal ? [
      { id: `${slug}-1`, hostedUrl: `https://jobs.lever.co/${slug}/${slug}-1`, text: "Revenue Operations Intern", descriptionPlain: "Remote internship", categories: { location: "Remote" }, workplaceType: "remote" },
      { id: `${slug}-2`, hostedUrl: `https://jobs.lever.co/${slug}/${slug}-2`, text: "Finance Manager", descriptionPlain: "Mumbai", categories: { location: "Mumbai, India" }, workplaceType: "on-site" },
    ] : [{
      id: `${slug}-1`,
      hostedUrl: `https://jobs.lever.co/${slug}/${slug}-1`,
      text: "Revenue Operations Intern",
      descriptionPlain: "Remote internship",
      categories: { location: "Remote" },
      workplaceType: "remote",
    }]);
  }
  if (provider === "ashby") {
    const slug = decodeURIComponent(url.pathname.split("/").pop() ?? "flagright.com");
    return Response.json({
      apiVersion: "1",
      jobs: [{
        isListed: true,
        jobUrl: `https://jobs.ashbyhq.com/${slug}/ashby-intern-1`,
        title: "Product Operations Intern",
        descriptionPlain: "Implementation and automation internship",
        location: "Remote",
        workplaceType: "Remote",
        publishedAt: "2026-08-25T00:00:00Z",
      }],
    });
  }
  if (provider === "workable") {
    const slug = url.pathname.split("/").pop() ?? "2070health";
    return Response.json({
      name: "2070Health",
      jobs: [{
        shortcode: "WORKABLE-1",
        application_url: `https://apply.workable.com/${slug}/j/WORKABLE-1/`,
        title: "Business Operations Intern",
        description: "Health-tech operations internship",
        city: "Bengaluru",
        country: "India",
        workplace_type: "hybrid",
        published_on: "2026-08-25",
      }],
    });
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const company = parts[2] ?? "BoschGroup";
  if (parts.length === 4) {
    return Response.json({
      totalFound: 1,
      content: [{ id: "744000000000001", name: "Business Analyst Intern" }],
    });
  }
  return Response.json({
    active: true,
    id: parts[4] ?? "744000000000001",
    company: { identifier: company, name: "Bosch Group" },
    postingUrl: `https://jobs.smartrecruiters.com/${company}/744000000000001-Business-Analyst-Intern`,
    name: "Business Analyst Intern",
    jobAd: { sections: { jobDescription: { text: "Internship supporting requirements, workflow analysis and UAT" } } },
    location: { city: "Bengaluru", country: "India", remote: false },
    releasedDate: "2026-08-25T00:00:00Z",
  });
}

test("lead discovery uses only a controlled public ATS catalog with India-relevant sources", () => {
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.controlledSourcesOnly, true);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.arbitraryUrlFetch, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.linkedinScrape, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.submit, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.send, false);
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.length >= 26);
  const providers = new Set(Object.keys(SOURCE_HOSTS));
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.every((source) => providers.has(source.provider)));
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.every((source) => new URL(source.sourceUrl).hostname === SOURCE_HOSTS[source.provider]));
  for (const company of ["Paytm", "PhonePe", "Razorpay", "Drivetrain", "Fresh Prints", "Flagright", "2070Health", "Bosch Group"]) {
    assert.ok(CONTROLLED_DISCOVERY_SOURCES.some((source) => source.company === company), `${company} should be registered`);
  }
});

test("controlled discovery keeps worldwide internships while preserving India roles and official URLs", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return successfulProviderResponse(url, { greenhouseGlobal: true });
  }) as typeof fetch;

  const result = await discoverControlledInternships();
  assert.equal(result.failures.length, 0);
  assert.ok(result.leads.length > CONTROLLED_DISCOVERY_SOURCES.length);
  assert.ok(result.leads.every((lead) => /Intern/i.test(lead.title)));
  assert.ok(result.leads.some((lead) => lead.location === "Bengaluru, India"));
  assert.ok(result.leads.some((lead) => lead.location === "New York, NY"), "global on-site internships must remain discoverable");
  assert.ok(result.leads.every((lead) => lead.canonicalUrl.startsWith("https://")));
  assert.ok(result.leads.every((lead) => lead.snapshotRequired));
});

test("controlled discovery does not burst registered boards at the same ATS provider", async () => {
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.providerBoundedConcurrency, true);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.maxConcurrentRequestsPerProvider, 1);
  const active = new Map<string, number>();
  const maxActive = new Map<string, number>();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const provider = providerForRequest(url);
    const current = (active.get(provider) ?? 0) + 1;
    active.set(provider, current);
    maxActive.set(provider, Math.max(maxActive.get(provider) ?? 0, current));
    await new Promise((resolve) => setTimeout(resolve, 10));
    active.set(provider, (active.get(provider) ?? 1) - 1);
    return successfulProviderResponse(url);
  }) as typeof fetch;

  const result = await discoverControlledInternships();
  assert.equal(result.failures.length, 0);
  assert.equal(result.leads.length, CONTROLLED_DISCOVERY_SOURCES.length);
  for (const provider of Object.keys(SOURCE_HOSTS)) assert.equal(maxActive.get(provider), 1, provider);
});

test("controlled discovery distinguishes stale sources from provider rate limits", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("", { status: url.hostname === "boards-api.greenhouse.io" ? 404 : 429 });
  }) as typeof fetch;

  const result = await discoverControlledInternships();
  assert.equal(result.leads.length, 0);
  assert.ok(result.failures.some((failure) => failure.reason.includes("catalog review")));
  assert.ok(result.failures.some((failure) => failure.reason.includes("rate-limited")));
});
