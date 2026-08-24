import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROLLED_DISCOVERY_SOURCES,
  LEAD_DISCOVERY_CAPABILITIES,
  discoverControlledInternships,
} from "../lib/scout/lead-discovery.ts";

const originalFetch = globalThis.fetch;

test.after(() => { globalThis.fetch = originalFetch; });

test("lead discovery uses only a controlled public ATS catalog with India-relevant sources", () => {
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.controlledSourcesOnly, true);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.arbitraryUrlFetch, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.linkedinScrape, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.submit, false);
  assert.equal(LEAD_DISCOVERY_CAPABILITIES.send, false);
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.length >= 12);
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.every((source) => source.provider === "greenhouse" || source.provider === "lever"));
  assert.ok(CONTROLLED_DISCOVERY_SOURCES.every((source) => /^https:\/\/(job-boards\.greenhouse\.io|jobs\.lever\.co)\//.test(source.sourceUrl)));
  for (const company of ["Paytm", "PhonePe", "Razorpay", "Drivetrain", "Fresh Prints"]) {
    assert.ok(CONTROLLED_DISCOVERY_SOURCES.some((source) => source.company === company), `${company} should be registered`);
  }
});

test("controlled discovery keeps worldwide internships while preserving India roles and official URLs", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "boards-api.greenhouse.io") {
      const slug = url.pathname.split("/")[3];
      return Response.json({ jobs: [
        { id: `${slug}-1`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-1`, title: "Product Operations Intern", content: "Internship in Bengaluru, India", location: { name: "Bengaluru, India" }, updated_at: "2026-08-24T00:00:00Z" },
        { id: `${slug}-2`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-2`, title: "Senior Engineer", content: "India", location: { name: "Bengaluru, India" } },
        { id: `${slug}-3`, absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-3`, title: "Marketing Intern", content: "Internship in New York", location: { name: "New York, NY" }, updated_at: "2026-08-23T00:00:00Z" },
      ]});
    }
    if (url.hostname === "api.lever.co") {
      const slug = url.pathname.split("/").pop();
      return Response.json([
        { id: `${slug}-1`, hostedUrl: `https://jobs.lever.co/${slug}/${slug}-1`, text: "Revenue Operations Intern", descriptionPlain: "Remote internship", categories: { location: "Remote" }, workplaceType: "remote" },
        { id: `${slug}-2`, hostedUrl: `https://jobs.lever.co/${slug}/${slug}-2`, text: "Finance Manager", descriptionPlain: "Mumbai", categories: { location: "Mumbai, India" }, workplaceType: "on-site" },
      ]);
    }
    throw new Error(`unexpected URL ${url}`);
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
    const provider = url.hostname === "boards-api.greenhouse.io" ? "greenhouse" : "lever";
    const current = (active.get(provider) ?? 0) + 1;
    active.set(provider, current);
    maxActive.set(provider, Math.max(maxActive.get(provider) ?? 0, current));
    await new Promise((resolve) => setTimeout(resolve, 10));
    active.set(provider, (active.get(provider) ?? 1) - 1);

    if (provider === "greenhouse") {
      const slug = url.pathname.split("/")[3];
      return Response.json({ jobs: [{
        id: `${slug}-1`,
        absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${slug}-1`,
        title: "Product Operations Intern",
        content: "Internship in Bengaluru, India",
        location: { name: "Bengaluru, India" },
        updated_at: "2026-08-25T00:00:00Z",
      }] });
    }
    const slug = url.pathname.split("/").pop();
    return Response.json([{
      id: `${slug}-1`,
      hostedUrl: `https://jobs.lever.co/${slug}/${slug}-1`,
      text: "Revenue Operations Intern",
      descriptionPlain: "Remote internship",
      categories: { location: "Remote" },
      workplaceType: "remote",
    }]);
  }) as typeof fetch;

  const result = await discoverControlledInternships();
  assert.equal(result.failures.length, 0);
  assert.equal(result.leads.length, CONTROLLED_DISCOVERY_SOURCES.length);
  assert.equal(maxActive.get("greenhouse"), 1);
  assert.equal(maxActive.get("lever"), 1);
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
