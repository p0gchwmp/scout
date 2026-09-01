import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EXTERNAL_LEAD_CAPABILITIES, normalizeExternalLead } from "../lib/scout/external-lead.ts";

test("M42 accepts visible Sprout context but requires independently resolved employer evidence", () => {
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
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.oneClickVisiblePageCapture, true);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.automaticOfficialResolution, true);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.automaticApplicationPreparation, true);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.automaticPublicContactResearch, true);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.fetchSproutAccount, false);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.callUndocumentedSproutApi, false);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.scrapeSprout, false);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.trustSproutAsEmployerEvidence, false);
  assert.equal(EXTERNAL_LEAD_CAPABILITIES.autoAcceptContact, false);
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

test("M42 one-click pipeline remains owner-gated, evidence-first and non-sending", async () => {
  const [route, resolutionRoute, page, client, home, manifest, capture] = await Promise.all([
    readFile(new URL("../app/api/external-leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/lead-resolution/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/external-leads/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/external-leads/external-leads-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../browser/scout-sprout-capture/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../browser/scout-sprout-capture/popup.js", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireScoutApiUser/);
  assert.match(route, /requireSameOriginMutation/);
  assert.match(route, /source: "lead:external:sprout"/);
  assert.match(route, /currentSnapshotId: null/);
  assert.match(route, /External discovery source \(Sprout\)/);
  assert.match(resolutionRoute, /resolvedJobIds/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(client, /\/api\/lead-promotion/);
  assert.match(client, /\/api\/applications/);
  assert.match(client, /\/api\/contacts\/research/);
  assert.match(client, /Nothing was submitted or sent/);
  assert.match(home, /External Leads/);
  assert.match(manifest, /"activeTab"/);
  assert.doesNotMatch(manifest, /usesprout\.com/);
  assert.match(capture, /chrome\.scripting\.executeScript/);
  assert.match(capture, /127\.0\.0\.1:3000\/external-leads/);
  assert.doesNotMatch(capture, /cookies|fetch\([^)]*usesprout/i);
  assert.doesNotMatch(route, /fetch\([^)]*usesprout/i);
});
