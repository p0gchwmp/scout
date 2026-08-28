import assert from "node:assert/strict";
import test from "node:test";
import { researchPublishedCompanyContacts } from "../agent/contact-research.ts";

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

test("public recruiter research fetches published evidence beyond the company site without scraping LinkedIn", async () => {
  const fetched: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    fetched.push(url);
    if (url === "https://careers.example.edu/fair/example-health") {
      return html("Example Health campus recruiting and internship contact: universityrecruiting@examplehealth.com");
    }
    if (url === "https://events.example.org/example-health") {
      return html("Example Health internship recruiting team: recruiter [at] examplehealth [dot] com. Personal backup: examplehealthjobs@gmail.com");
    }
    return html("not found", 404);
  };
  const searchProvider = {
    provider: "test-search",
    async searchFixedQuery() {
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
  assert.equal(result.searchQueriesAttempted, 3);
  assert.ok(result.publicPagesAttempted >= 2);
  assert.ok(result.candidates.some((candidate) => candidate.email === "universityrecruiting@examplehealth.com" && candidate.sourceContext === "university_career"));
  assert.ok(result.candidates.some((candidate) => candidate.email === "recruiter@examplehealth.com"));
  assert.ok(!result.candidates.some((candidate) => candidate.email.endsWith("@gmail.com")));
  assert.ok(!fetched.some((url) => url.includes("linkedin.com")));
});

test("public recruiter research does not accept a third-party page without company and recruiting context", async () => {
  const searchProvider = {
    provider: "test-search",
    async searchFixedQuery() {
      return [{ url: "https://random.example.org/directory", title: "Directory", description: "General directory", age: null }];
    },
  };
  const result = await researchPublishedCompanyContacts({
    companyName: "Example Health",
    companyDomain: "examplehealth.com",
    jobSnapshotId: "company-target:test-2",
    searchProvider,
    fetcher: async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      return url.includes("random.example.org")
        ? html("Contact random-team@random.example.org for general questions.")
        : html("not found", 404);
    },
  });
  assert.equal(result.candidates.length, 0);
});
