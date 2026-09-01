import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_RESEARCH_CAPABILITIES, researchPublishedCompanyContacts } from "../agent/contact-research.ts";

function fetcherFor(html: string) {
  return async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/careers") return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };
}

test("M29 rejects careers mailbox when the published purpose is anti-fraud reporting", async () => {
  const result = await researchPublishedCompanyContacts({
    companyDomain: "example.com",
    jobSnapshotId: "snapshot-anti-fraud",
    careersUrl: "https://example.com/careers",
    fetcher: fetcherFor("<p>If you receive a suspicious recruiter message or recruitment scam, report fraud to careers@example.com.</p>"),
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(CONTACT_RESEARCH_CAPABILITIES.wrongPurposeContextRejected, true);
});

test("M29 keeps careers mailbox when the official page explicitly invites applications", async () => {
  const result = await researchPublishedCompanyContacts({
    companyDomain: "example.com",
    jobSnapshotId: "snapshot-applications",
    careersUrl: "https://example.com/careers",
    fetcher: fetcherFor("<p>For internship opportunities, send your resume to careers@example.com.</p>"),
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.email, "careers@example.com");
});
