import assert from "node:assert/strict";
import test from "node:test";
import { OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES, resolveSearchLeadToOfficialAts } from "../agent/official-resolution.ts";

const NO_MATCH = /No sufficiently matched official Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, BambooHR, Recruitee, Teamtailor, or Breezy posting/;

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
          description: "Acme Labs product internship",
          age: null,
        }];
      },
    },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "greenhouse");
      assert.equal(slug, "acmelabs");
      assert.equal(externalId, "987");
      return [{
        source: "greenhouse",
        externalId: "987",
        canonicalUrl: "https://job-boards.greenhouse.io/acmelabs/jobs/987",
        company: "acmelabs",
        title: "Product Management Intern",
        description: "Product work",
        location: "India",
        workplaceType: "remote",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(result.snapshot.sourceProvider, "greenhouse");
  assert.equal(result.snapshot.externalId, "987");
  assert.equal(result.snapshot.canonicalUrl, "https://job-boards.greenhouse.io/acmelabs/jobs/987");
  assert.equal(result.source.boardToken, "acmelabs");
  assert.equal(result.source.companyDomain, "unresolved.invalid");
  assert.ok(queries.some((query) => query.includes("site:job-boards.greenhouse.io")));
});

test("search lead resolution promotes a verified Ashby posting after public API re-fetch", async () => {
  const result = await resolveSearchLeadToOfficialAts({ leadUrl: "https://www.linkedin.com/jobs/view/ashby", company: "Acme Labs", title: "Product Intern" }, {
    searchProvider: { async searchFixedQuery(query) { return query.includes("ashbyhq") ? [{ url: "https://jobs.ashbyhq.com/acme/abc123", title: "Product Intern at Acme Labs", description: "Acme Labs internship", age: null }] : []; } },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "ashby"); assert.equal(slug, "acme"); assert.equal(externalId, "abc123");
      return [{ source: "ashby", externalId: "abc123", canonicalUrl: "https://jobs.ashbyhq.com/acme/abc123", company: "acme", title: "Product Intern", description: "Product work", location: "India", workplaceType: "remote" }];
    },
    async resolveCompanyDomain() { return null; },
  });
  assert.equal(result.snapshot.sourceProvider, "ashby");
});

test("search lead resolution promotes a verified Workable posting after public API re-fetch", async () => {
  const result = await resolveSearchLeadToOfficialAts({ leadUrl: "https://www.glassdoor.com/job-listing/acme", company: "Acme Labs", title: "Operations Intern" }, {
    searchProvider: { async searchFixedQuery(query) { return query.includes("workable") ? [{ url: "https://apply.workable.com/acme/j/ABCD1234/", title: "Operations Intern - Acme Labs", description: "Acme Labs operations internship", age: null }] : []; } },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "workable"); assert.equal(slug, "acme"); assert.equal(externalId, "ABCD1234");
      return [{ source: "workable", externalId: "ABCD1234", canonicalUrl: "https://apply.workable.com/acme/j/ABCD1234/", company: "Acme Labs", title: "Operations Intern", description: "Operations work", location: "India", workplaceType: "hybrid" }];
    },
    async resolveCompanyDomain() { return null; },
  });
  assert.equal(result.snapshot.sourceProvider, "workable");
});

test("search lead resolution promotes a verified SmartRecruiters posting by exact posting id", async () => {
  const result = await resolveSearchLeadToOfficialAts({ leadUrl: "https://www.linkedin.com/jobs/view/sr", company: "Acme Labs", title: "Business Analyst Intern" }, {
    searchProvider: { async searchFixedQuery(query) { return query.includes("smartrecruiters") ? [{ url: "https://jobs.smartrecruiters.com/AcmeLabs/744000012345678-Business-Analyst-Intern", title: "Business Analyst Intern - Acme Labs", description: "Acme Labs analyst internship", age: null }] : []; } },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "smartrecruiters"); assert.equal(slug, "AcmeLabs"); assert.equal(externalId, "744000012345678");
      return [{ source: "smartrecruiters", externalId: "744000012345678", canonicalUrl: "https://jobs.smartrecruiters.com/AcmeLabs/744000012345678-Business-Analyst-Intern", company: "Acme Labs", title: "Business Analyst Intern", description: "Analysis work", location: "India", workplaceType: "hybrid" }];
    },
    async resolveCompanyDomain() { return null; },
  });
  assert.equal(result.snapshot.sourceProvider, "smartrecruiters");
});

test("search lead resolution promotes an exact observed Workday posting without guessing tenant or site", async () => {
  const result = await resolveSearchLeadToOfficialAts({ leadUrl: "https://www.linkedin.com/jobs/view/workday", company: "Acme Labs", title: "Finance Intern" }, {
    searchProvider: { async searchFixedQuery(query) { return query.includes("myworkday") ? [{ url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/India/Finance-Intern_R-123", title: "Finance Intern - Acme Labs", description: "Acme Labs finance internship", age: null }] : []; } },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "workday"); assert.equal(slug, "acme.wd5.myworkdayjobs.com|en-US|External"); assert.equal(externalId, "India/Finance-Intern_R-123");
      return [{ source: "workday", externalId: "India/Finance-Intern_R-123", canonicalUrl: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/India/Finance-Intern_R-123", company: "Acme Labs", title: "Finance Intern", description: "Finance work", location: "India", workplaceType: "hybrid" }];
    },
    async resolveCompanyDomain() { return null; },
  });
  assert.equal(result.snapshot.sourceProvider, "workday");
});

test("search lead resolution promotes an exact BambooHR careers posting after detail re-fetch", async () => {
  const result = await resolveSearchLeadToOfficialAts({ leadUrl: "https://www.linkedin.com/jobs/view/bamboo", company: "Acme Labs", title: "Operations Intern" }, {
    searchProvider: { async searchFixedQuery(query) { return query.includes("bamboohr") ? [{ url: "https://acme.bamboohr.com/careers/42", title: "Operations Intern - Acme Labs", description: "Acme Labs operations internship", age: null }] : []; } },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "bamboohr"); assert.equal(slug, "acme"); assert.equal(externalId, "42");
      return [{ source: "bamboohr", externalId: "42", canonicalUrl: "https://acme.bamboohr.com/careers/42", company: "Acme Labs", title: "Operations Intern", description: "Operations work", location: "India", workplaceType: "hybrid" }];
    },
    async resolveCompanyDomain() { return null; },
  });
  assert.equal(result.snapshot.sourceProvider, "bamboohr");
});

test("search lead resolution fails closed before using search evidence when persistence is disabled", async () => {
  await assert.rejects(() => resolveSearchLeadToOfficialAts({ leadUrl: "https://www.linkedin.com/jobs/view/123", company: "Acme Labs", title: "Product Intern" }, {
    searchProvider: { allowResultPersistence: false, async searchFixedQuery() { throw new Error("should not search"); } },
  }), /cannot be persisted until search result persistence is explicitly allowed/);
});

test("search lead resolution carries a verified company domain into the registered source", async () => {
  const result = await resolveSearchLeadToOfficialAts({ leadUrl: "https://www.linkedin.com/jobs/view/123", company: "Acme Labs", title: "Product Intern" }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("greenhouse")) return [];
        return [{ url: "https://job-boards.greenhouse.io/acmelabs/jobs/987", title: "Product Intern at Acme Labs", description: "Acme Labs product internship", age: null }];
      },
    },
    async discover() {
      return [{ source: "greenhouse", externalId: "987", canonicalUrl: "https://job-boards.greenhouse.io/acmelabs/jobs/987", company: "acmelabs", title: "Product Intern", description: "Product work", location: "India", workplaceType: "remote" }];
    },
    async resolveCompanyDomain(company) {
      assert.equal(company, "Acme Labs");
      return { domain: "acme.com", careersUrl: "https://acme.com/careers", confidence: "high" as const, evidence: [
        { queryId: "official", url: "https://acme.com/", title: "Acme Labs", description: "Official site" },
        { queryId: "careers", url: "https://acme.com/careers", title: "Acme Labs Careers", description: "Open roles" },
      ] };
    },
  });
  assert.equal(result.source.companyDomain, "acme.com");
  assert.equal(result.source.careersUrl, "https://acme.com/careers");
  assert.equal(result.resolutionEvidence.companyDomainEvidence.length, 2);
});

test("search lead resolution rejects mismatched company or role evidence", async () => {
  await assert.rejects(() => resolveSearchLeadToOfficialAts({ leadUrl: "https://www.glassdoor.co.in/job-listing/example", company: "Acme Labs", title: "Operations Intern" }, {
    searchProvider: { async searchFixedQuery() { return [{ url: "https://jobs.lever.co/othercompany/abc-defgh", title: "Operations Intern at Other Company", description: "Other Company internship", age: null }]; } },
    async discover() { throw new Error("ATS discovery should not run for mismatched company evidence"); },
    async resolveCompanyDomain() { throw new Error("Domain resolution should not run"); },
  }), NO_MATCH);

  await assert.rejects(() => resolveSearchLeadToOfficialAts({ leadUrl: "https://www.linkedin.com/jobs/view/456", company: "Acme Labs", title: "Finance Intern" }, {
    searchProvider: { async searchFixedQuery(query) { return query.includes("greenhouse") ? [{ url: "https://job-boards.greenhouse.io/acmelabs/jobs/777", title: "Software Engineering Intern at Acme Labs", description: "Acme Labs internship", age: null }] : []; } },
    async discover() { return [{ source: "greenhouse", externalId: "777", canonicalUrl: "https://job-boards.greenhouse.io/acmelabs/jobs/777", company: "acmelabs", title: "Software Engineering Intern", description: "Engineering role", location: "India", workplaceType: "remote" }]; },
    async resolveCompanyDomain() { throw new Error("Domain resolution should not run"); },
  }), NO_MATCH);
});

test("official search resolution cannot fetch arbitrary result pages or submit", () => {
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.serverDerivedQueriesOnly, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.greenhouse, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.lever, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.ashby, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.workable, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.smartrecruiters, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.workday, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.bamboohr, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.recruitee, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.teamtailor, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.breezy, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.arbitraryResultPageFetch, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.linkedinScrape, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.companyDomainGuessing, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.submitApplication, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.sendEmail, false);
});
