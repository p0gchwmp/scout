import assert from "node:assert/strict";
import test from "node:test";
import {
  LEAD_CONTEXT_CAPABILITIES,
  fetchApifyLeadContext,
  normalizeLinkedInLeadUrl,
  pushLeadContextToUnify,
  sanitizeLeadContextRecord,
} from "../lib/scout/lead-context-providers.ts";

test("LinkedIn lead URLs are manual exact public person/company/job URLs", () => {
  assert.deepEqual(normalizeLinkedInLeadUrl("https://linkedin.com/in/example-person?trk=test#x"), {
    url: "https://www.linkedin.com/in/example-person",
    profileType: "person",
  });
  assert.equal(normalizeLinkedInLeadUrl("https://www.linkedin.com/company/example-co/").profileType, "company");
  assert.equal(normalizeLinkedInLeadUrl("https://www.linkedin.com/jobs/view/123456789/").profileType, "job");
  assert.throws(() => normalizeLinkedInLeadUrl("https://www.google.com/search?q=linkedin"), /linkedin\.com HTTPS URL/);
  assert.throws(() => normalizeLinkedInLeadUrl("https://user:pass@www.linkedin.com/in/example-person"), /linkedin\.com HTTPS URL/);
  assert.throws(() => normalizeLinkedInLeadUrl("https://www.linkedin.com/search/results/people/"), /person, company, or job page/);
});

test("provider records are destructively sanitized before Scout can use them", () => {
  const context = sanitizeLeadContextRecord({
    provider: "phantombuster",
    linkedinUrl: "https://www.linkedin.com/in/example-person",
    observedAt: "2026-09-01T10:00:00Z",
    raw: {
      fullName: "Example Person",
      headline: "Talent Partner",
      companyName: "Example Co",
      location: "Bengaluru, India",
      about: "Hiring product and operations interns.",
      email: "private@example.com",
      phone: "+91 99999 99999",
      whatsapp: "+91 88888 88888",
      address: "Exact street address",
      experience: [{ title: "Talent Partner", companyName: "Example Co", email: "hidden@example.com" }],
      education: [{ schoolName: "Example University", degreeName: "MBA" }],
    },
  });
  assert.equal(context.fullName, "Example Person");
  assert.equal(context.company, "Example Co");
  assert.match(context.experience[0], /Talent Partner/);
  assert.match(context.education[0], /Example University/);
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /private@example\.com|hidden@example\.com|99999|88888|Exact street address/);
});

test("Apify integration uses one manually supplied LinkedIn URL and returns only sanitized context", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const context = await fetchApifyLeadContext({
    apiToken: "token-123",
    actorId: "simpleapi/linkedin-profile-scraper",
    linkedinUrl: "https://www.linkedin.com/in/example-person?trk=abc",
    now: () => new Date("2026-09-01T11:00:00Z"),
    fetcher: async (input, init) => {
      calledUrl = String(input);
      calledInit = init;
      return new Response(JSON.stringify([{
        fullName: "Example Person",
        headline: "Recruiter",
        companyName: "Example Co",
        email: "should-not-survive@example.com",
        mobile: "+1 555 123 4567",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(calledUrl, "https://api.apify.com/v2/acts/simpleapi~linkedin-profile-scraper/run-sync-get-dataset-items");
  assert.equal((calledInit?.headers as Record<string, string>).authorization, "Bearer token-123");
  assert.deepEqual(JSON.parse(String(calledInit?.body)), { profileUrls: ["https://www.linkedin.com/in/example-person"] });
  assert.equal(context.fullName, "Example Person");
  assert.doesNotMatch(JSON.stringify(context), /should-not-survive|555/);
});

test("Unify sink receives only sanitized lead-context attributes", async () => {
  const context = sanitizeLeadContextRecord({
    provider: "apify",
    linkedinUrl: "https://www.linkedin.com/in/example-person",
    observedAt: "2026-09-01T12:00:00Z",
    raw: { fullName: "Example Person", headline: "Recruiter", email: "drop@example.com", phone: "123456789" },
  });
  let requestBody = "";
  await pushLeadContextToUnify({
    apiKey: "unify-key",
    objectName: "scout_lead_context",
    context,
    fetcher: async (input, init) => {
      assert.equal(String(input), "https://api.unifygtm.com/data/v1/objects/scout_lead_context/records");
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "unify-key");
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ status: "success", data: { id: "record-1" } }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  const body = JSON.parse(requestBody) as { attributes: Record<string, unknown> };
  assert.equal(body.attributes.full_name, "Example Person");
  assert.doesNotMatch(requestBody, /drop@example\.com|123456789|email|phone|whatsapp|address/i);
});

test("M27 provider capabilities cannot become outreach evidence or sending capability", () => {
  assert.equal(LEAD_CONTEXT_CAPABILITIES.manualLinkedInUrlRequired, true);
  assert.equal(LEAD_CONTEXT_CAPABILITIES.providerReturnedEmailPersisted, false);
  assert.equal(LEAD_CONTEXT_CAPABILITIES.providerReturnedPhonePersisted, false);
  assert.equal(LEAD_CONTEXT_CAPABILITIES.providerReturnedAddressPersisted, false);
  assert.equal(LEAD_CONTEXT_CAPABILITIES.directOutreachEvidence, false);
  assert.equal(LEAD_CONTEXT_CAPABILITIES.sendEmail, false);
  assert.equal(LEAD_CONTEXT_CAPABILITIES.submitApplication, false);
});
