import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_RESEARCH_CAPABILITIES, researchPublishedCompanyContacts } from "../agent/contact-research.ts";

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

test("v1 recruiter research stays on verified first-party company surfaces", async () => {
  const fetched: string[] = [];
  let searchCalls = 0;
  const fetcher = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    fetched.push(url);
    if (url === "https://examplehealth.com/careers") {
      return html("Example Health campus recruiting and internship contact: universityrecruiting@examplehealth.com");
    }
    if (url === "https://examplehealth.com/team") {
      return html("Talent team: talent@examplehealth.com. Engineering lead: jane.doe@examplehealth.com");
    }
    return html("not found", 404);
  };
  const searchProvider = {
    provider: "test-search",
    async searchFixedQuery() {
      searchCalls += 1;
      return [
        { url: "https://www.linkedin.com/in/private-recruiter", title: "Example Health recruiter", description: "LinkedIn profile", age: null },
        { url: "https://careers.example.edu/fair/example-health", title: "Example Health career fair", description: "Campus recruiting internship email", age: null },
        { url: "https://events.example.org/example-health", title: "Example Health recruiting event", description: "Talent and internship contact", age: null },
      ];
    },
  };

  const result = await researchPublishedCompanyContacts({
    companyName: "Example Health",
    companyDomain: "examplehealth.com",
    jobSnapshotId: "company-target:test",
    searchProvider,
    fetcher,
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(searchCalls, 0);
  assert.equal(result.searchQueriesAttempted, 0);
  assert.equal(result.publicPagesAttempted, 0);
  assert.ok(result.candidates.some((candidate) => candidate.email === "universityrecruiting@examplehealth.com"));
  assert.ok(result.candidates.some((candidate) => candidate.email === "talent@examplehealth.com"));
  assert.ok(!result.candidates.some((candidate) => candidate.email === "jane.doe@examplehealth.com"));
  assert.ok(!fetched.some((url) => url.includes("linkedin.com") || url.includes("example.edu") || url.includes("events.example.org")));
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.thirdPartyPublicPageFetch, false);
});

test("v1 recruiter research ignores third-party search evidence even when it looks recruiting-related", async () => {
  let searchCalls = 0;
  const searchProvider = {
    provider: "test-search",
    async searchFixedQuery() {
      searchCalls += 1;
      return [{ url: "https://random.example.org/directory", title: "Example Health recruiter directory", description: "Campus recruiting", age: null }];
    },
  };
  const fetched: string[] = [];
  const result = await researchPublishedCompanyContacts({
    companyName: "Example Health",
    companyDomain: "examplehealth.com",
    jobSnapshotId: "company-target:test-2",
    searchProvider,
    fetcher: async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      fetched.push(url);
      return html("not found", 404);
    },
  });
  assert.equal(searchCalls, 0);
  assert.equal(result.candidates.length, 0);
  assert.ok(!fetched.some((url) => url.includes("random.example.org")));
});
