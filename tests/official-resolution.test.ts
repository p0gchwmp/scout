import assert from "node:assert/strict";
import test from "node:test";
import { OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES, resolveSearchLeadToOfficialAts } from "../agent/official-resolution.ts";

test("search lead resolution re-fetches a matched Greenhouse posting before returning a snapshot", async () => {
  const queries: string[] = [];
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.linkedin.com/jobs/view/123",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        queries.push(query);
        if (!query.includes("greenhouse")) return [];
        return [{
          url: "https://job-boards.greenhouse.io/acmelabs/jobs/987",
          title: "Product Management Intern at Acme Labs",
          description: "Acme Labs is hiring a Product Management Intern in India",
          age: "2 days ago",
        }];
      },
    },
    async discover(provider, slug) {
      assert.equal(provider, "greenhouse");
      assert.equal(slug, "acmelabs");
      return [{
        source: "greenhouse",
        externalId: "987",
        canonicalUrl: "https://job-boards.greenhouse.io/acmelabs/jobs/987",
        company: "acmelabs",
        title: "Product Management Intern",
        description: "Work with product and operations teams.",
        location: "Bengaluru, India",
        workplaceType: "hybrid",
        postedAt: "2026-08-23T00:00:00Z",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(queries.length, 4);
  assert.ok(queries.every((query) => query.includes('"Acme Labs"') && query.includes('"Product Intern"')));
  assert.ok(queries.some((query) => query.includes("site:jobs.ashbyhq.com")));
  assert.ok(queries.some((query) => query.includes("site:apply.workable.com")));
  assert.equal(result.source.provider, "greenhouse");
  assert.equal(result.source.boardToken, "acmelabs");
  assert.equal(result.source.companyDomain, "unresolved.invalid");
  assert.equal(result.snapshot.externalId, "987");
  assert.equal(result.snapshot.company, "Acme Labs");
  assert.equal(result.resolutionEvidence.originalLeadUrl, "https://www.linkedin.com/jobs/view/123");
  assert.equal(result.resolutionEvidence.companyDomainResolved, false);
});

test("search lead resolution promotes a verified Ashby posting after public API re-fetch", async () => {
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.linkedin.com/jobs/view/ashby-lead",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("ashbyhq.com")) return [];
        return [{
          url: "https://jobs.ashbyhq.com/acme/abc-123",
          title: "Product Intern at Acme Labs",
          description: "Acme Labs product internship in India",
          age: null,
        }];
      },
    },
    async discover(provider, slug) {
      assert.equal(provider, "ashby");
      assert.equal(slug, "acme");
      return [{
        source: "ashby",
        externalId: "abc-123",
        canonicalUrl: "https://jobs.ashbyhq.com/acme/abc-123",
        company: "acme",
        title: "Product Intern",
        description: "Product internship",
        location: "Bengaluru, India",
        workplaceType: "hybrid",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(result.source.provider, "ashby");
  assert.equal(result.source.boardToken, "acme");
  assert.equal(result.source.careersUrl, "https://jobs.ashbyhq.com/acme");
  assert.equal(result.snapshot.externalId, "abc-123");
});

test("search lead resolution promotes a verified Workable posting after public API re-fetch", async () => {
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.glassdoor.co.in/job-listing/acme-operations-intern",
    company: "Acme Health",
    title: "Operations Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("apply.workable.com")) return [];
        return [{
          url: "https://apply.workable.com/acme/j/AB12CD/",
          title: "Operations Intern - Acme Health",
          description: "Acme Health is hiring an Operations Intern in India",
          age: null,
        }];
      },
    },
    async discover(provider, slug) {
      assert.equal(provider, "workable");
      assert.equal(slug, "acme");
      return [{
        source: "workable",
        externalId: "AB12CD",
        canonicalUrl: "https://apply.workable.com/acme/j/AB12CD/",
        company: "Acme Health",
        title: "Operations Intern",
        description: "Operations internship",
        location: "Bengaluru, Karnataka, India",
        workplaceType: "on-site",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(result.source.provider, "workable");
  assert.equal(result.source.boardToken, "acme");
  assert.equal(result.source.careersUrl, "https://apply.workable.com/acme/");
  assert.equal(result.snapshot.externalId, "AB12CD");
});

test("search lead resolution fails closed before using search evidence when persistence is disabled", async () => {
  let searches = 0;
  await assert.rejects(() => resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.linkedin.com/jobs/view/123",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      allowResultPersistence: false,
      async searchFixedQuery() { searches += 1; return []; },
    },
  }), /cannot be persisted until search result persistence is explicitly allowed/);
  assert.equal(searches, 0);
});

test("search lead resolution carries a verified company domain into the registered source", async () => {
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.glassdoor.co.in/job-listing/acme-product-intern",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("greenhouse")) return [];
        return [{
          url: "https://job-boards.greenhouse.io/acmelabs/jobs/987",
          title: "Product Intern at Acme Labs",
          description: "Acme Labs product internship",
          age: null,
        }];
      },
    },
    async discover() {
      return [{
        source: "greenhouse",
        externalId: "987",
        canonicalUrl: "https://job-boards.greenhouse.io/acmelabs/jobs/987",
        company: "acmelabs",
        title: "Product Intern",
        description: "Product work",
        location: "India",
        workplaceType: "remote",
      }];
    },
    async resolveCompanyDomain(company) {
      assert.equal(company, "Acme Labs");
      return {
        domain: "acme.com",
        careersUrl: "https://acme.com/careers",
        confidence: "high" as const,
        evidence: [
          { queryId: "official", url: "https://acme.com/", title: "Acme Labs", description: "Official site" },
          { queryId: "careers", url: "https://acme.com/careers", title: "Acme Labs Careers", description: "Open roles" },
        ],
      };
    },
  });

  assert.equal(result.source.companyDomain, "acme.com");
  assert.equal(result.source.careersUrl, "https://acme.com/careers");
  assert.equal(result.resolutionEvidence.companyDomainResolved, true);
  assert.equal(result.resolutionEvidence.companyDomain, "acme.com");
  assert.equal(result.resolutionEvidence.companyDomainEvidence.length, 2);
});

test("search lead resolution rejects a result whose company evidence does not match", async () => {
  await assert.rejects(() => resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.glassdoor.co.in/job-listing/example",
    company: "Acme Labs",
    title: "Operations Intern",
  }, {
    searchProvider: {
      async searchFixedQuery() {
        return [{
          url: "https://jobs.lever.co/othercompany/abc-defgh",
          title: "Operations Intern at Other Company",
          description: "Other Company internship",
          age: null,
        }];
      },
    },
    async discover() {
      throw new Error("ATS discovery should not run for mismatched company evidence");
    },
    async resolveCompanyDomain() { throw new Error("Domain resolution should not run"); },
  }), /No sufficiently matched official Greenhouse, Lever, Ashby, or Workable posting/);
});

test("search lead resolution rejects an ATS posting whose role does not match", async () => {
  await assert.rejects(() => resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.linkedin.com/jobs/view/456",
    company: "Acme Labs",
    title: "Finance Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("greenhouse")) return [];
        return [{
          url: "https://job-boards.greenhouse.io/acmelabs/jobs/777",
          title: "Software Engineering Intern at Acme Labs",
          description: "Acme Labs internship",
          age: null,
        }];
      },
    },
    async discover() {
      return [{
        source: "greenhouse",
        externalId: "777",
        canonicalUrl: "https://job-boards.greenhouse.io/acmelabs/jobs/777",
        company: "acmelabs",
        title: "Software Engineering Intern",
        description: "Engineering role",
        location: "India",
        workplaceType: "remote",
      }];
    },
    async resolveCompanyDomain() { throw new Error("Domain resolution should not run"); },
  }), /No sufficiently matched official Greenhouse, Lever, Ashby, or Workable posting/);
});

test("official search resolution cannot fetch arbitrary result pages or submit", () => {
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.serverDerivedQueriesOnly, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.greenhouse, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.lever, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.ashby, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.workable, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.refetchOfficialAts, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.resolveCompanyDomainFromConvergingEvidence, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.searchPersistenceGateRequired, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.arbitraryResultPageFetch, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.linkedinScrape, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.companyDomainGuessing, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.submitApplication, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.sendEmail, false);
});
