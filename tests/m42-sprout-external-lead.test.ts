import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EXTERNAL_LEAD_CAPABILITIES, normalizeExternalLead } from "../lib/scout/external-lead.ts";

test("M42 imports Sprout only as lead context and preserves an independent official resolution candidate", () => {
  const lead = normalizeExternalLead({
    source: "sprout",
    leadUrl: "https://www.usesprout.com/jobs/example-role",
    company: "Example Co",
    title: "Product Intern",
    officialUrl: "https://jobs.lever.co/example/abc123",
  });
  assert.equal(lead.trust, "lead_only");
  assert.equal(lead.requiresOfficialResolution, true);
  assert.equal(lead.leadUrl, "https://www.usesprout.com/jobs/example-role");
  assert.equal(lead.resolutionCandidateUrl, "https://jobs.lever.co/example/abc123");
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.fetchSproutAccount, false);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.callUndocumentedSproutApi, false);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.scrapeSprout, false);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.trustSproutAsEmployerEvidence, false);
});

test("M42 refuses to disguise another Sprout URL as independent employer evidence", () => {
  assert.throws(() => normalizeExternalLead({
    source: "sprout",
    leadUrl: "https://app.usesprout.com/job/1",
    company: "Example",
    title: "Intern",
    officialUrl: "https://help.usesprout.com/job/1",
  }), /independent of Sprout/);
  assert.throws(() => normalizeExternalLead({ source: "sprout", leadUrl: "https://evil.example/job/1", company: "Example", title: "Intern" }), /usesprout\.com/);
});

test("M42 external lead route remains owner/same-origin gated and creates only unresolved jobs", async () => {
  const [route, page, client, home] = await Promise.all([
    readFile(new URL("../app/api/external-leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/external-leads/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/external-leads/external-leads-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireScoutApiUser/);
  assert.match(route, /requireSameOriginMutation/);
  assert.match(route, /source: "lead:external:sprout"/);
  assert.match(route, /currentSnapshotId: null/);
  assert.match(route, /Official posting snapshot required before application preparation/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(client, /does not do:<\/strong> sign into Sprout, use your subscription, call undocumented APIs, scrape listings, spend credits, or submit applications/);
  assert.match(home, /External Leads/);
  assert.doesNotMatch(route, /fetch\([^)]*usesprout/i);
});
