import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DISCOVERY_CAPABILITIES, runAgentDiscovery } from "../agent/discovery.ts";

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
    }],
    failures: [{ company: "Other", provider: "greenhouse", reason: "temporarily unavailable" }],
  }), () => "2026-08-24T01:00:00.000Z");

  assert.equal(discovery.found, 1);
  assert.equal(discovery.leads[0].platformId, "lever");
  assert.equal(discovery.leads[0].canonicalUrl, "https://jobs.lever.co/acme/abc-12345");
  assert.equal("description" in discovery.leads[0], false);
  assert.equal(discovery.failures.length, 1);
});

test("cloud agent discovery cannot accept arbitrary sources or perform external side effects", () => {
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.controlledCatalogOnly, true);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.callerSuppliedSources, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.arbitraryUrlFetch, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.linkedinScrape, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.sendEmail, false);
  assert.equal(AGENT_DISCOVERY_CAPABILITIES.submitApplication, false);
});
