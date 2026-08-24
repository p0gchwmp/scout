import assert from "node:assert/strict";
import test from "node:test";
import { BreezyOfficialPageAdapter, parseBreezyPublicJobUrl } from "../lib/breezy-adapter.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("parseBreezyPublicJobUrl admits only exact hosted public position URLs", () => {
  const parsed = parseBreezyPublicJobUrl("https://codebase.breezy.hr/p/abe2d2b35511-marketing-executive-marketing-manager");
  assert.equal(parsed.tenant, "codebase");
  assert.equal(parsed.externalId, "abe2d2b35511");
  assert.equal(parsed.canonicalUrl, "https://codebase.breezy.hr/p/abe2d2b35511-marketing-executive-marketing-manager");

  assert.throws(() => parseBreezyPublicJobUrl("https://api.breezy.hr/v3/company/acme/positions"), /host is not a supported/);
  assert.throws(() => parseBreezyPublicJobUrl("https://codebase.breezy.hr/p/abe2d2b35511-marketing?ref=linkedin"), /exact HTTPS candidate-site URL/);
  assert.throws(() => parseBreezyPublicJobUrl("https://codebase.breezy.hr/"), /path is invalid/);
  assert.throws(() => parseBreezyPublicJobUrl("https://codebase.breezy.hr/p/abe2d2b35511-marketing%00bad"), /invalid position segment/);
});

test("Breezy adapter resolves exact public JobPosting metadata", async () => {
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://codebase.breezy.hr/p/abe2d2b35511-marketing-executive-marketing-manager");
    const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Marketing Executive / Marketing Manager",
      description: "Own B2B SaaS marketing and market research.",
      url: "https://codebase.breezy.hr/p/abe2d2b35511-marketing-executive-marketing-manager",
      datePosted: "2026-08-20",
      hiringOrganization: { "@type": "Organization", name: "Codebase" },
      jobLocation: { "@type": "Place", address: { addressLocality: "Pune", addressRegion: "MH", addressCountry: "IN" } },
    })}</script></head><body><h1>Marketing Executive / Marketing Manager</h1><button>Apply to Position</button></body></html>`;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };

  const job = await new BreezyOfficialPageAdapter().discoverPostingUrl("https://codebase.breezy.hr/p/abe2d2b35511-marketing-executive-marketing-manager");
  assert.ok(job);
  assert.equal(job.source, "breezy");
  assert.equal(job.externalId, "abe2d2b35511");
  assert.equal(job.company, "Codebase");
  assert.equal(job.title, "Marketing Executive / Marketing Manager");
  assert.equal(job.location, "Pune, MH, IN");
});

test("Breezy adapter discovers bounded public portal positions then re-fetches details", async () => {
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url === "https://uvation.breezy.hr/") {
      return new Response(`<!doctype html><a href="/p/abcdef123456-ai-ml-engineer">AI/ML Engineer</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url === "https://uvation.breezy.hr/p/abcdef123456-ai-ml-engineer") {
      return new Response(`<!doctype html><html><head><title>AI/ML Engineer at Uvation</title></head><body><h1>AI/ML Engineer</h1><div>India remote contract</div><button>Apply to Position</button></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unexpected ${url}`);
  };

  const jobs = await new BreezyOfficialPageAdapter().discover("uvation");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, "abcdef123456");
  assert.equal(jobs[0].company, "Uvation");
  assert.equal(jobs[0].workplaceType, "remote");
  assert.deepEqual(seen, [
    "https://uvation.breezy.hr/",
    "https://uvation.breezy.hr/p/abcdef123456-ai-ml-engineer",
  ]);
});

test("Breezy adapter rejects mismatched JobPosting provenance", async () => {
  globalThis.fetch = async () => new Response(`<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Role",
    url: "https://codebase.breezy.hr/p/deadbeef9999-other-role",
  })}</script>`, { status: 200, headers: { "content-type": "text/html" } });

  await assert.rejects(
    () => new BreezyOfficialPageAdapter().discoverPostingUrl("https://codebase.breezy.hr/p/abe2d2b35511-marketing-executive-marketing-manager"),
    /metadata does not match/,
  );
});
