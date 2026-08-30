import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DISCOVERY_CAPABILITIES, runAgentDiscovery } from "../agent/discovery.ts";

const noPublicBoards = async () => ({
  leads: [],
  failures: [],
  modes: { weWorkRemotelyRss: true as const, joobleApi: false },
});

test("cloud agent discovery returns compact controlled lead metadata", async () => {
  const discovery = await runAgentDiscovery(async () => ({
    leads: [{
      canonicalUrl: "https://jobs.lever.co/acme/abc-12345",
      company: "Acme",
      title: "Product Intern",
      channel: { id: "lever", label: "Lever", kind: "ats", automation: "structured", note: "test", requiresOfficialResolution: false, easyApplyAssist: false },
      snapshotRequired: true,
      nextStep: "Resolve this official ATS posting into an immutable job snapshot",
      provider: "lever",
      sourceUrl: "https://jobs.lever.co/acme",
      focus: "product",
      location: "Remote - India",
      description: "Large job description that discovery does not need to return to the control plane.",
      postedAt: "2026-08-24T00:00:00Z",
    }, {
      canonicalUrl: "https://jobs.ashbyhq.com/acme/ashby-123",
      company: "Acme",
      title: "Operations Intern",
      channel: { id: "ashby", label: "Ashby", kind: "ats", automation: "structured", note: "test", requiresOfficialResolution: false, easyApplyAssist: false },
      snapshotRequired: true,
      nextStep: "Resolve this official ATS posting into an immutable job snapshot",
      provider: "ashby",
      sourceUrl: "https://jobs.ashbyhq.com/acme",
      focus: "operations",
      location: "Bengaluru, India",
      description: "Description stays off the compact agent response.",
      postedAt: "2026-08-23T00:00:00Z",
    }],
    failures: [{ company: "Other", provider: "greenhouse", reason: "temporarily unavailable" }],
  }), () => "2026-08-24T01:00:00.000Z", async () => ({ enabled: false, leads: [], failures: [] }), noPublicBoards);

  assert.equal(discovery.found, 2);
  assert.equal(discovery.leads[0].platformId, "lever");
  assert.equal(discovery.leads[0].canonicalUrl, "https://jobs.lever.co/acme/abc-12345");
  assert.equal(discovery.leads[1].provider, "ashby");
  assert.equal("description" in discovery.leads[0], false);
  assert.equal(discovery.failures.length, 1);
  assert.equal(discovery.qualitySummary.inputCount, 2);
  assert.equal(discovery.qualitySummary.duplicatesCollapsed, 0);
});

test("cloud agent collapses a job-board copy into the controlled official ATS lead", async () => {
  const discovery = await runAgentDiscovery(async () => ({
    leads: [{
      canonicalUrl: "https://jobs.lever.co/acme/official-1",
      company: "Acme Technologies",
      title: "Business Analyst Intern",
      channel: { id: "lever", label: "Lever", kind: "ats", automation: "structured", note: "test", requiresOfficialResolution: false, easyApplyAssist: false },
      snapshotRequired: true,
      nextStep: "Resolve official ATS evidence",
      provider: "lever",
      sourceUrl: "https://jobs.lever.co/acme",
      focus: "analytics",
      location: "Bengaluru, India",
      description: "Business analysis internship",
      postedAt: "2026-08-24T00:00:00Z",
    }],
    failures: [],
  }), () => "2026-08-25T00:00:00.000Z", async () => ({
    enabled: true,
    leads: [{
      provider: "search_index" as const,
      canonicalUrl: "https://www.linkedin.com/jobs/view/123456",
      company: "Acme Technologies Pvt Ltd",
      title: "Business Analyst Internship",
      sourceUrl: "https://www.linkedin.com/jobs/view/123456",
      focus: "analytics",
      location: "Bengaluru, India",
      postedAt: null,
      platformId: "linkedin",
      nextStep: "Resolve employer and official job evidence before application preparation.",
    }],
    failures: [],
  }), noPublicBoards);

  assert.equal(discovery.found, 1);
  assert.equal(discovery.leads[0].provider, "lever");
  assert.match(discovery.leads[0].focus, /1 duplicate lead consolidated/);
  assert.match(discovery.leads[0].nextStep, /Discovery provenance observed across/);
  assert.equal(discovery.qualitySummary.inputCount, 2);
  assert.equal(discovery.qualitySummary.uniqueCount, 1);
  assert.equal(discovery.qualitySummary.duplicatesCollapsed, 1);
});

test("public-board feeds remain lead-only and are not promoted to official ATS authority", async () => {
  const discovery = await runAgentDiscovery(
    async () => ({ leads: [], failures: [] }),
    () => "2026-08-28T10:00:00.000Z",
    async () => ({ enabled: false, leads: [], failures: [] }),
    async () => ({
      leads: [{
        provider: "public_board" as const,
        canonicalUrl: "https://weworkremotely.com/remote-jobs/acme-product-intern",
        company: "Acme",
        title: "Product Intern",
        sourceUrl: "https://weworkremotely.com/remote-jobs.rss",
        focus: "remote product internship",
        location: "Remote",
        postedAt: "2026-08-28T08:00:00.000Z",
        platformId: "weworkremotely" as const,
        nextStep: "Resolve official employer evidence first.",
      }],
      failures: [],
      modes: { weWorkRemotelyRss: true as const, joobleApi: false },
    }),
  );

  assert.equal(discovery.found, 1);
  assert.equal(discovery.leads[0].provider, "search_index");
  assert.equal(discovery.leads[0].platformId, "weworkremotely");
  assert.match(discovery.leads[0].focus, /review quality/);
  assert.match(discovery.leads[0].focus, /Job-board lead requiring official resolution/);
});

test("cloud agent discovery cannot accept arbitrary sources or perform external side effects", () => {
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.controlledCatalog, true);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.publicBoardFeeds, true);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.weWorkRemotelyRss, true);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.joobleOptInOnly, true);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.opportunityDedupe, true);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.preferOfficialAts, true);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.callerSuppliedSources, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.arbitraryUrlFetch, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.linkedinScrape, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.sendEmail, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.submitApplication, false);
});
