import assert from "node:assert/strict";
import test from "node:test";
import { parseTeamtailorPublicJobUrl, TeamtailorOfficialPageAdapter } from "../lib/teamtailor-adapter.ts";

function withFetch(mock: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  return fn().finally(() => { globalThis.fetch = original; });
}

function jobHtml(id: string, slug: string, title: string) {
  return `<!doctype html><html><body><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title,
    description: "<p>Work with product and operations teams.</p>",
    datePosted: "2026-08-24",
    url: `https://acme.teamtailor.com/jobs/${id}-${slug}`,
    hiringOrganization: { "@type": "Organization", name: "Acme Labs" },
    jobLocationType: "TELECOMMUTE",
    jobLocation: { "@type": "Place", address: { addressLocality: "Bengaluru", addressRegion: "Karnataka", addressCountry: "India" } },
  })}</script></body></html>`;
}

test("Teamtailor parser binds exact hosted tenant and numeric job id", () => {
  assert.deepEqual(parseTeamtailorPublicJobUrl("https://acme.teamtailor.com/jobs/8124573-product-intern"), {
    tenant: "acme",
    externalId: "8124573",
    jobSegment: "8124573-product-intern",
    canonicalUrl: "https://acme.teamtailor.com/jobs/8124573-product-intern",
  });
  assert.throws(() => parseTeamtailorPublicJobUrl("https://careers.acme.com/jobs/8124573-product-intern"), /not a supported Teamtailor-hosted/);
  assert.throws(() => parseTeamtailorPublicJobUrl("https://acme.teamtailor.com/jobs/8124573-product-intern?utm_source=x"), /exact HTTPS/);
  assert.throws(() => parseTeamtailorPublicJobUrl("https://acme.teamtailor.com/connect"), /path is invalid/);
  assert.throws(() => parseTeamtailorPublicJobUrl("https://acme.teamtailor.com/jobs/8124573"), /job id and title slug/);
});

test("Teamtailor exact page resolver prefers public JobPosting metadata", async () => {
  await withFetch((async (input, init) => {
    assert.equal(String(input), "https://acme.teamtailor.com/jobs/8124573-product-intern");
    assert.equal(init?.redirect, "error");
    assert.match(String(new Headers(init?.headers).get("accept")), /text\/markdown/);
    return new Response(jobHtml("8124573", "product-intern", "Product Intern"), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch, async () => {
    const job = await new TeamtailorOfficialPageAdapter().discoverPostingUrl("https://acme.teamtailor.com/jobs/8124573-product-intern");
    assert.equal(job?.externalId, "8124573");
    assert.equal(job?.company, "Acme Labs");
    assert.equal(job?.title, "Product Intern");
    assert.equal(job?.description, "Work with product and operations teams.");
    assert.equal(job?.location, "Bengaluru, Karnataka, India");
    assert.equal(job?.workplaceType, "remote");
    assert.equal(job?.postedAt, "2026-08-24");
  });
});

test("Teamtailor exact page resolver accepts agent-facing Markdown without API credentials", async () => {
  await withFetch((async () => new Response(`Finance · Stockholm · Hybrid\n\n# Group Financial Controller\n\nApply for this job\n\nOwn group accounting and reporting.`, {
    status: 200,
    headers: { "content-type": "text/markdown; charset=utf-8" },
  })) as typeof fetch, async () => {
    const adapter = new TeamtailorOfficialPageAdapter();
    const job = await adapter.discoverPostingUrl("https://career.teamtailor.com/jobs/8124573-group-financial-controller");
    assert.equal(job?.title, "Group Financial Controller");
    assert.equal(job?.workplaceType, "hybrid");
    assert.equal(adapter.capabilities.apiKey, false);
    assert.equal(adapter.capabilities.employerApiCredentials, false);
    assert.equal(adapter.capabilities.customDomainGuessing, false);
    assert.equal(adapter.capabilities.submission, false);
  });
});

test("Teamtailor registered discovery uses public sitemap then exact job pages", async () => {
  const calls: string[] = [];
  await withFetch((async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://acme.teamtailor.com/sitemap") {
      return new Response(`<a href="/jobs/8124573-product-intern">Product Intern</a><a href="https://acme.teamtailor.com/jobs/8124574-finance-intern">Finance Intern</a><a href="/locations/bengaluru">Location</a>`, { headers: { "content-type": "text/html" } });
    }
    if (url.endsWith("8124573-product-intern")) return new Response(jobHtml("8124573", "product-intern", "Product Intern"), { headers: { "content-type": "text/html" } });
    if (url.endsWith("8124574-finance-intern")) return new Response(jobHtml("8124574", "finance-intern", "Finance Intern"), { headers: { "content-type": "text/html" } });
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch, async () => {
    const jobs = await new TeamtailorOfficialPageAdapter().discover("acme");
    assert.deepEqual(jobs.map((job) => job.externalId).sort(), ["8124573", "8124574"]);
    assert.equal(calls[0], "https://acme.teamtailor.com/sitemap");
    assert.equal(calls.length, 3);
  });
});

test("Teamtailor exact id lookup never guesses the title slug", async () => {
  await withFetch((async (input) => {
    const url = String(input);
    if (url.endsWith("/sitemap")) {
      return new Response(`[Product Intern](https://acme.teamtailor.com/jobs/8124573-real-public-slug)`, { headers: { "content-type": "text/markdown" } });
    }
    assert.equal(url, "https://acme.teamtailor.com/jobs/8124573-real-public-slug");
    return new Response(jobHtml("8124573", "real-public-slug", "Product Intern"), { headers: { "content-type": "text/html" } });
  }) as typeof fetch, async () => {
    const job = await new TeamtailorOfficialPageAdapter().discoverPosting("acme", "8124573");
    assert.equal(job?.canonicalUrl, "https://acme.teamtailor.com/jobs/8124573-real-public-slug");
  });
});

test("Teamtailor resolver fails closed on non-job content and mismatched metadata", async () => {
  await withFetch((async () => new Response("<html><body><h1>Careers</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch, async () => {
    await assert.rejects(() => new TeamtailorOfficialPageAdapter().discoverPostingUrl("https://acme.teamtailor.com/jobs/8124573-product-intern"), /verifiable job-posting content/);
  });

  await withFetch((async () => new Response(`<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Product Intern",
    url: "https://acme.teamtailor.com/jobs/9999999-other-role",
  })}</script>`, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch, async () => {
    await assert.rejects(() => new TeamtailorOfficialPageAdapter().discoverPostingUrl("https://acme.teamtailor.com/jobs/8124573-product-intern"), /metadata does not match/);
  });
});
