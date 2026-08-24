import assert from "node:assert/strict";
import test from "node:test";
import { AshbyAdapter, SmartRecruitersAdapter, WorkablePublicAdapter } from "../lib/adapters.ts";

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

test("Ashby adapter uses only the public posting API and excludes unlisted jobs", async () => {
  const calls: string[] = [];
  const jobs = await withFetch((async (input) => {
    const url = new URL(String(input));
    calls.push(url.href);
    assert.equal(url.origin + url.pathname, "https://api.ashbyhq.com/posting-api/job-board/acme");
    assert.equal(url.searchParams.get("includeCompensation"), "false");
    return Response.json({
      apiVersion: "1",
      jobs: [
        {
          title: "Product Intern",
          location: "Bengaluru",
          isListed: true,
          isRemote: false,
          workplaceType: "Hybrid",
          descriptionPlain: "Work with the product team.",
          publishedAt: "2026-08-20T10:00:00Z",
          employmentType: "Intern",
          jobUrl: "https://jobs.ashbyhq.com/acme/abc-123",
          applyUrl: "https://jobs.ashbyhq.com/acme/abc-123/application",
        },
        {
          title: "Hidden role",
          location: "Remote",
          isListed: false,
          workplaceType: "Remote",
          descriptionPlain: "Direct link only",
          jobUrl: "https://jobs.ashbyhq.com/acme/hidden-1",
          applyUrl: "https://jobs.ashbyhq.com/acme/hidden-1/application",
        },
      ],
    });
  }) as typeof fetch, () => new AshbyAdapter().discover("acme"));

  assert.equal(calls.length, 1);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    source: "ashby",
    externalId: "abc-123",
    canonicalUrl: "https://jobs.ashbyhq.com/acme/abc-123",
    company: "acme",
    title: "Product Intern",
    description: "Work with the product team.",
    location: "Bengaluru",
    workplaceType: "hybrid",
    postedAt: "2026-08-20T10:00:00Z",
  });
});

test("Workable public adapter uses the unauthenticated account endpoint and maps job-page URL", async () => {
  const calls: string[] = [];
  const jobs = await withFetch((async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.href);
    assert.equal(url.origin + url.pathname, "https://www.workable.com/api/accounts/acme");
    assert.equal(url.searchParams.get("details"), "true");
    assert.equal((init?.headers as Record<string, string> | undefined)?.Authorization, undefined);
    return Response.json({
      name: "Acme Health",
      jobs: [{
        title: "Operations Intern",
        code: "OPS-1",
        shortcode: "AB12CD",
        country: "India",
        state: "Karnataka",
        city: "Bengaluru",
        telecommuting: false,
        published_on: "2026-08-21",
        url: "https://apply.workable.com/acme/j/AB12CD/apply/",
        application_url: "https://apply.workable.com/acme/j/AB12CD/",
        shortlink: "https://wrkbl.ink/example",
        description: "Support business and operations projects.",
        workplace_type: "on_site",
      }],
    });
  }) as typeof fetch, () => new WorkablePublicAdapter().discover("acme"));

  assert.equal(calls.length, 1);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    source: "workable",
    externalId: "AB12CD",
    canonicalUrl: "https://apply.workable.com/acme/j/AB12CD/",
    company: "Acme Health",
    title: "Operations Intern",
    description: "Support business and operations projects.",
    location: "Bengaluru, Karnataka, India",
    workplaceType: "on-site",
    postedAt: "2026-08-21",
  });
});

test("SmartRecruiters adapter uses only public posting endpoints and never sends an auth token", async () => {
  const calls: string[] = [];
  const jobs = await withFetch((async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.href);
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("x-smarttoken"), false);
    assert.equal(headers.has("authorization"), false);

    if (url.pathname === "/v1/companies/acme/postings") {
      assert.equal(url.searchParams.get("destination"), "PUBLIC");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.equal(url.searchParams.get("offset"), "0");
      return Response.json({ totalFound: 1, content: [{ id: "74944235" }] });
    }

    assert.equal(url.pathname, "/v1/companies/acme/postings/74944235");
    return Response.json({
      id: "74944235",
      name: "Product Intern",
      company: { identifier: "acme", name: "Acme Labs" },
      releasedDate: "2026-08-23T12:00:00Z",
      location: { city: "Bengaluru", region: "Karnataka", country: "in", remote: false },
      postingUrl: "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
      applyUrl: "https://jobs.smartrecruiters.com/acme/74944235-product-intern?oga=true",
      jobAd: {
        sections: {
          companyDescription: { text: "Acme builds healthcare software." },
          jobDescription: { text: "Work with the product and operations teams." },
          qualifications: { text: "Current undergraduate student." },
          additionalInformation: { text: "India internship." },
        },
      },
      active: true,
    });
  }) as typeof fetch, () => new SmartRecruitersAdapter().discover("acme"));

  assert.equal(calls.length, 2);
  assert.deepEqual(jobs, [{
    source: "smartrecruiters",
    externalId: "74944235",
    canonicalUrl: "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
    company: "Acme Labs",
    title: "Product Intern",
    description: "Acme builds healthcare software.\n\nWork with the product and operations teams.\n\nCurrent undergraduate student.\n\nIndia internship.",
    location: "Bengaluru, Karnataka, in",
    workplaceType: "unspecified",
    postedAt: "2026-08-23T12:00:00Z",
  }]);
});

test("public ATS adapters expose discovery but no submission capability", () => {
  for (const adapter of [new AshbyAdapter(), new WorkablePublicAdapter(), new SmartRecruitersAdapter()]) {
    assert.equal(adapter.capabilities.discovery, true);
    assert.equal(adapter.capabilities.submission, false);
  }
});
