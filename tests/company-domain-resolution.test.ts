import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANY_DOMAIN_RESOLUTION_CAPABILITIES,
  resolveOfficialCompanyDomain,
} from "../agent/company-domain-resolution.ts";

const result = (url: string, title: string, description: string) => ({ url, title, description, age: null });

test("company domain resolution requires two server-derived searches to converge", async () => {
  const queries: string[] = [];
  const resolved = await resolveOfficialCompanyDomain("Acme Labs", {
    async searchFixedQuery(query) {
      queries.push(query);
      if (query.includes("official website")) {
        return [result("https://www.acme.com/", "Acme Labs | Official Website", "Acme Labs builds healthcare software.")];
      }
      return [result("https://careers.acme.com/jobs", "Careers at Acme Labs", "Join Acme Labs and view open jobs.")];
    },
  });

  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => query.includes('"Acme Labs"')));
  assert.equal(resolved?.domain, "acme.com");
  assert.equal(resolved?.careersUrl, "https://careers.acme.com/jobs");
  assert.equal(resolved?.confidence, "high");
  assert.equal(resolved?.evidence.length, 2);
});

test("company domain resolution fails closed when search-result persistence is disabled", async () => {
  let calls = 0;
  await assert.rejects(() => resolveOfficialCompanyDomain("Acme Labs", {
    allowResultPersistence: false,
    async searchFixedQuery() { calls += 1; return []; },
  }), /cannot be persisted until search result persistence is explicitly allowed/);
  assert.equal(calls, 0);
});

test("company domain resolution handles common multipart public suffixes", async () => {
  const resolved = await resolveOfficialCompanyDomain("Example Health", {
    async searchFixedQuery(query) {
      return query.includes("official website")
        ? [result("https://www.examplehealth.co.in/", "Example Health", "Official site for Example Health")]
        : [result("https://careers.examplehealth.co.in/jobs", "Example Health Careers", "Jobs at Example Health")];
    },
  });
  assert.equal(resolved?.domain, "examplehealth.co.in");
});

test("company domain resolution rejects job boards and ATS domains even when search snippets match", async () => {
  const resolved = await resolveOfficialCompanyDomain("Acme Labs", {
    async searchFixedQuery(query) {
      return query.includes("official website")
        ? [result("https://www.linkedin.com/company/acme-labs", "Acme Labs", "Official LinkedIn page for Acme Labs")]
        : [result("https://job-boards.greenhouse.io/acmelabs", "Acme Labs Careers", "Open jobs at Acme Labs")];
    },
  });
  assert.equal(resolved, null);
});

test("company domain resolution rejects non-converging domains rather than guessing", async () => {
  const resolved = await resolveOfficialCompanyDomain("Acme Labs", {
    async searchFixedQuery(query) {
      return query.includes("official website")
        ? [result("https://acme.example/", "Acme Labs official site", "Acme Labs company website")]
        : [result("https://acmejobs.example/jobs", "Acme Labs careers", "Acme Labs job openings")];
    },
  });
  assert.equal(resolved, null);
});

test("company domain resolution rejects ambiguous equal-strength convergence", async () => {
  const resolved = await resolveOfficialCompanyDomain("Acme Labs", {
    async searchFixedQuery() {
      return [
        result("https://acme-one.com/careers", "Acme Labs Careers", "Acme Labs jobs"),
        result("https://acme-two.com/careers", "Acme Labs Careers", "Acme Labs jobs"),
      ];
    },
  });
  assert.equal(resolved, null);
});

test("company domain resolver has no guessing, crawling, send, or submit capability", () => {
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.serverDerivedQueriesOnly, true);
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.requiresConvergingSearchEvidence, true);
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.excludesJobBoardsAndSocialPlatforms, true);
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.searchPersistenceGateRequired, true);
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.companyDomainGuessing, false);
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.arbitraryPageFetch, false);
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.sendEmail, false);
  assert.equal(COMPANY_DOMAIN_RESOLUTION_CAPABILITIES.submitApplication, false);
});
