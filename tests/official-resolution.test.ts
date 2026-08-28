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

  assert.equal(queries.length, 7);
  assert.ok(queries.every((query) => query.includes('"Acme Labs"') && query.includes('"Product Intern"')));
  assert.ok(queries.some((query) => query.includes("site:jobs.ashbyhq.com")));
  assert.ok(queries.some((query) => query.includes("site:apply.workable.com")));
  assert.ok(queries.some((query) => query.includes("site:jobs.smartrecruiters.com")));
  assert.ok(queries.some((query) => query.includes("site:myworkdayjobs.com")));
  assert.ok(queries.some((query) => query.includes("site:bamboohr.com/careers")));
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
        return [{ url: "https://jobs.ashbyhq.com/acme/abc-123", title: "Product Intern at Acme Labs", description: "Acme Labs product internship in India", age: null }];
      },
    },
    async discover(provider, slug) {
      assert.equal(provider, "ashby");
      assert.equal(slug, "acme");
      return [{ source: "ashby", externalId: "abc-123", canonicalUrl: "https://jobs.ashbyhq.com/acme/abc-123", company: "acme", title: "Product Intern", description: "Product internship", location: "Bengaluru, India", workplaceType: "hybrid" }];
    },
    async resolveCompanyDomain() { return null; },
  });
  assert.equal(result.source.provider, "ashby");
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
        return [{ url: "https://apply.workable.com/acme/j/AB12CD/", title: "Operations Intern - Acme Health", description: "Acme Health is hiring an Operations Intern in India", age: null }];
      },
    },
    async discover(provider, slug) {
      assert.equal(provider, "workable");
      assert.equal(slug, "acme");
      return [{ source: "workable", externalId: "AB12CD", canonicalUrl: "https://apply.workable.com/acme/j/AB12CD/", company: "Acme Health", title: "Operations Intern", description: "Operations internship", location: "Bengaluru, Karnataka, India", workplaceType: "on-site" }];
    },
    async resolveCompanyDomain() { return null; },
  });
  assert.equal(result.source.provider, "workable");
  assert.equal(result.source.careersUrl, "https://apply.workable.com/acme/");
  assert.equal(result.snapshot.externalId, "AB12CD");
});

test("search lead resolution promotes a verified SmartRecruiters posting by exact posting id", async () => {
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.glassdoor.co.in/job-listing/acme-product-intern",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("jobs.smartrecruiters.com")) return [];
        return [{
          url: "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
          title: "Product Intern at Acme Labs",
          description: "Acme Labs product internship in India",
          age: null,
        }];
      },
    },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "smartrecruiters");
      assert.equal(slug, "acme");
      assert.equal(externalId, "74944235");
      return [{
        source: "smartrecruiters",
        externalId: "74944235",
        canonicalUrl: "https://jobs.smartrecruiters.com/acme/74944235-product-intern",
        company: "Acme Labs",
        title: "Product Intern",
        description: "Work with product and operations teams.",
        location: "Bengaluru, Karnataka, in",
        workplaceType: "unspecified",
        postedAt: "2026-08-23T12:00:00Z",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(result.source.provider, "smartrecruiters");
  assert.equal(result.source.boardToken, "acme");
  assert.equal(result.source.careersUrl, "https://careers.smartrecruiters.com/acme");
  assert.equal(result.snapshot.externalId, "74944235");
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test("search lead resolution promotes an exact observed Workday posting without guessing tenant or site", async () => {
  const boardToken = "acme.wd5.myworkdayjobs.com/en-US/External";
  const externalPath = "/job/Bengaluru/Product-Intern_R123";
  const jobUrl = `https://${boardToken}${externalPath}`;
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.linkedin.com/jobs/view/workday-lead",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("myworkdayjobs.com")) return [];
        return [{ url: jobUrl, title: "Product Intern - Acme Labs", description: "Acme Labs product internship in Bengaluru", age: null }];
      },
    },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "workday");
      assert.equal(slug, boardToken);
      assert.equal(externalId, externalPath);
      return [{
        source: "workday",
        externalId: externalPath,
        canonicalUrl: jobUrl,
        company: "acme",
        title: "Product Intern",
        description: "Work with product and operations teams.",
        location: "Bengaluru, India",
        workplaceType: "unspecified",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(result.source.provider, "workday");
  assert.equal(result.source.boardToken, boardToken);
  assert.equal(result.source.careersUrl, `https://${boardToken}`);
  assert.equal(result.snapshot.externalId, externalPath);
  assert.equal(result.snapshot.canonicalUrl, jobUrl);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test("search lead resolution promotes an exact BambooHR careers posting after detail re-fetch", async () => {
  const jobUrl = "https://acme.bamboohr.com/careers/42";
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.linkedin.com/jobs/view/bamboohr-lead",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("bamboohr.com/careers")) return [];
        return [{ url: jobUrl, title: "Product Intern - Acme Labs", description: "Acme Labs product internship in Bengaluru", age: null }];
      },
    },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "bamboohr");
      assert.equal(slug, "acme");
      assert.equal(externalId, "42");
      return [{
        source: "bamboohr",
        externalId: "42",
        canonicalUrl: jobUrl,
        company: "acme",
        title: "Product Intern",
        description: "Work with product and operations teams.",
        location: "Bengaluru, Karnataka, India",
        workplaceType: "hybrid",
        postedAt: "2026-08-23",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(result.source.provider, "bamboohr");
  assert.equal(result.source.boardToken, "acme");
  assert.equal(result.source.careersUrl, "https://acme.bamboohr.com/careers");
  assert.equal(result.snapshot.externalId, "42");
  assert.equal(result.snapshot.canonicalUrl, jobUrl);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test("search lead resolution may use search ephemerally when persistence is disabled but persists only refetched ATS evidence", async () => {
  let searches = 0;
  let domainLookups = 0;
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://weworkremotely.com/remote-jobs/acme-product-intern",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      allowResultPersistence: false,
      async searchFixedQuery(query) {
        searches += 1;
        if (!query.includes("greenhouse")) return [];
        return [{
          url: "https://job-boards.greenhouse.io/acmelabs/jobs/987",
          title: "Product Intern at Acme Labs",
          description: "UNTRUSTED SEARCH SNIPPET THAT MUST NOT BECOME THE JOB SNAPSHOT",
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
        company: "Acme Labs",
        title: "Product Intern",
        description: "Official ATS description from the refetched posting.",
        location: "India",
        workplaceType: "remote",
      }];
    },
    async resolveCompanyDomain() {
      domainLookups += 1;
      throw new Error("Company-domain search evidence must remain persistence-gated");
    },
  });

  assert.equal(searches, 7);
  assert.equal(domainLookups, 0);
  assert.equal(result.source.provider, "greenhouse");
  assert.equal(result.source.companyDomain, "unresolved.invalid");
  assert.equal(result.snapshot.canonicalUrl, "https://job-boards.greenhouse.io/acmelabs/jobs/987");
  assert.equal(result.snapshot.description, "Official ATS description from the refetched posting.");
  assert.doesNotMatch(result.snapshot.description, /UNTRUSTED SEARCH SNIPPET/);
  assert.equal(result.resolutionEvidence.companyDomainResolved, false);
});

test("search lead resolution carries a verified company domain into the registered source", async () => {
  const result = await resolveSearchLeadToOfficialAts({ leadUrl: "https://www.glassdoor.co.in/job-listing/acme-product-intern", company: "Acme Labs", title: "Product Intern" }, {
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
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.workdayTenantGuessing, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.bamboohrTenantGuessing, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.bamboohrEmployerApiCredentials, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.refetchOfficialAts, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.resolveCompanyDomainFromConvergingEvidence, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.searchPersistenceGateRequired, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.ephemeralSearchAllowedWhenPersistenceDisabled, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.officialSnapshotRequiredBeforePersistence, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.arbitraryResultPageFetch, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.linkedinScrape, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.companyDomainGuessing, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.submitApplication, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.sendEmail, false);
});
