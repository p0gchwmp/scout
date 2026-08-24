import assert from "node:assert/strict";
import test from "node:test";
import { OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES, resolveSearchLeadToOfficialAts } from "../agent/official-resolution.ts";

test("search lead resolution promotes an exact Recruitee careers posting", async () => {
  const result = await resolveSearchLeadToOfficialAts({
    leadUrl: "https://www.linkedin.com/jobs/view/recruitee-lead",
    company: "Acme Labs",
    title: "Product Intern",
  }, {
    searchProvider: {
      async searchFixedQuery(query) {
        if (!query.includes("recruitee.com")) return [];
        return [{
          url: "https://acme.recruitee.com/o/product-intern",
          title: "Product Intern - Acme Labs",
          description: "Acme Labs product internship in Bengaluru, India",
          age: null,
        }];
      },
    },
    async discover(provider, slug, externalId) {
      assert.equal(provider, "recruitee");
      assert.equal(slug, "acme");
      assert.equal(externalId, "product-intern");
      return [{
        source: "recruitee",
        externalId: "product-intern",
        canonicalUrl: "https://acme.recruitee.com/o/product-intern",
        company: "Acme Labs",
        title: "Product Intern",
        description: "Work with product and operations teams.",
        location: "Bengaluru, Karnataka, India",
        workplaceType: "hybrid",
        postedAt: "2026-08-23T10:00:00Z",
      }];
    },
    async resolveCompanyDomain() { return null; },
  });

  assert.equal(result.source.provider, "recruitee");
  assert.equal(result.source.boardToken, "acme");
  assert.equal(result.source.careersUrl, "https://acme.recruitee.com/");
  assert.equal(result.snapshot.externalId, "product-intern");
  assert.equal(result.snapshot.canonicalUrl, "https://acme.recruitee.com/o/product-intern");
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test("Recruitee structured resolution adds no send, submit, token, or tenant-guessing capability", () => {
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.recruitee, true);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.recruiteeTenantGuessing, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.recruiteeCareersApiToken, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.submitApplication, false);
  assert.equal(OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES.sendEmail, false);
});
