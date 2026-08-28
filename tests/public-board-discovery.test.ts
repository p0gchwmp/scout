import assert from "node:assert/strict";
import test from "node:test";
import { discoverPublicBoardInternships, PUBLIC_BOARD_DISCOVERY_CAPABILITIES } from "../agent/public-board-discovery.ts";

test("WWR discovery uses only the fixed public RSS feed and keeps results lead-only", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher = (async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    assert.equal(url, "https://weworkremotely.com/remote-jobs.rss");
    return new Response(`<?xml version="1.0"?><rss><channel>
      <item>
        <title><![CDATA[Acme Labs: Product Intern]]></title>
        <link>https://weworkremotely.com/remote-jobs/acme-labs-product-intern</link>
        <description><![CDATA[Help the product and operations team as a student intern.]]></description>
        <category>Product</category>
        <pubDate>Thu, 27 Aug 2026 10:00:00 GMT</pubDate>
      </item>
      <item>
        <title><![CDATA[Acme Labs: Senior Product Manager]]></title>
        <link>https://weworkremotely.com/remote-jobs/acme-labs-senior-product-manager</link>
        <description><![CDATA[Lead product strategy.]]></description>
      </item>
    </channel></rss>`, { status: 200, headers: { "content-type": "application/rss+xml" } });
  }) as typeof fetch;

  const result = await discoverPublicBoardInternships({}, fetcher);
  assert.equal(calls.length, 1);
  assert.equal(result.modes.weWorkRemotelyRss, true);
  assert.equal(result.modes.joobleApi, false);
  assert.equal(result.failures.length, 0);
  assert.equal(result.leads.length, 1);
  assert.deepEqual(result.leads[0], {
    provider: "public_board",
    canonicalUrl: "https://weworkremotely.com/remote-jobs/acme-labs-product-intern",
    company: "Acme Labs",
    title: "Product Intern",
    sourceUrl: "https://weworkremotely.com/remote-jobs.rss",
    focus: "Remote early-career lead from the official We Work Remotely public RSS feed",
    location: "Remote",
    postedAt: "2026-08-27T10:00:00.000Z",
    platformId: "weworkremotely",
    nextStep: "Resolve the employer and an official company/ATS posting before application preparation or outreach research.",
  });
});

test("Jooble India is opt-in and makes at most one bounded API request per Scout run", async () => {
  let joobleCalls = 0;
  const fetcher = (async (input, init) => {
    const url = String(input);
    if (url === "https://weworkremotely.com/remote-jobs.rss") {
      return new Response("<rss><channel></channel></rss>", { status: 200 });
    }
    joobleCalls += 1;
    assert.equal(url, "https://in.jooble.org/api/test-key");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      keywords: "internship",
      location: "India",
      page: 1,
      ResultOnPage: 50,
      companysearch: false,
    });
    return Response.json({ jobs: [
      {
        title: "Business Analyst Intern",
        company: "Example Health",
        location: "India",
        snippet: "Student internship supporting research and operations.",
        type: "Internship",
        link: "https://jobs.examplehealth.com/business-analyst-intern",
        updated: "2026-08-28T08:00:00Z",
      },
      {
        title: "Senior Engineer",
        company: "Example Health",
        location: "India",
        snippet: "Experienced engineer role.",
        type: "Full-time",
        link: "https://jobs.examplehealth.com/senior-engineer",
        updated: "2026-08-28T08:00:00Z",
      },
    ] });
  }) as typeof fetch;

  const result = await discoverPublicBoardInternships({ SCOUT_JOOBLE_ENABLED: "1", SCOUT_JOOBLE_API_KEY: "test-key" }, fetcher);
  assert.equal(joobleCalls, 1);
  assert.equal(result.modes.joobleApi, true);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].platformId, "jooble");
  assert.match(result.leads[0].nextStep, /lead only/i);
  assert.equal(PUBLIC_BOARD_DISCOVERY_CAPABILITIES.joobleMaxRequestsPerRun, 1);
  assert.equal(PUBLIC_BOARD_DISCOVERY_CAPABILITIES.privateContactScrape, false);
  assert.equal(PUBLIC_BOARD_DISCOVERY_CAPABILITIES.sendEmail, false);
  assert.equal(PUBLIC_BOARD_DISCOVERY_CAPABILITIES.submitApplication, false);
});

test("Jooble remains disabled without explicit opt-in and missing keys fail closed", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response("<rss><channel></channel></rss>", { status: 200 });
  }) as typeof fetch;

  const disabled = await discoverPublicBoardInternships({}, fetcher);
  assert.equal(calls, 1);
  assert.equal(disabled.modes.joobleApi, false);

  const enabledWithoutKey = await discoverPublicBoardInternships({ SCOUT_JOOBLE_ENABLED: "1" }, fetcher);
  assert.equal(calls, 2);
  assert.equal(enabledWithoutKey.modes.joobleApi, true);
  assert.equal(enabledWithoutKey.failures.length, 1);
  assert.match(enabledWithoutKey.failures[0].reason, /not configured/i);
});
