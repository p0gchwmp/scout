import assert from "node:assert/strict";
import test from "node:test";
import {
  ECOSYSTEM_ADJACENT_LANES,
  ECOSYSTEM_DISCOVERY_CAPABILITIES,
  ECOSYSTEM_SEARCH_QUERIES,
  ECOSYSTEM_SOURCES,
  assessEcosystemRecruitingContact,
  buildEcosystemOutreachSeeds,
  normalizeEcosystemSearchResult,
} from "../lib/scout/ecosystem-discovery.ts";

test("registered investor and accelerator portfolio boards are lead-only and require employer resolution before Safe Fill", () => {
  for (const url of [
    "https://jobs.blume.vc/companies/example/jobs/123-product-intern",
    "https://careers.peakxv.com/jobs/123",
    "https://careers.chiratae.com/jobs/123",
    "https://jobs.nexusvp.com/jobs/123",
    "https://jobs.accel.com/jobs/123",
    "https://jobs.a16z.com/jobs/123",
    "https://jobs.generalcatalyst.com/jobs/123",
    "https://jobs.lsvp.com/jobs/123",
    "https://jobs.khoslaventures.com/jobs/123",
    "https://jobs.8vc.com/jobs/123",
    "https://jobs.baincapitalventures.com/jobs/123",
    "https://jobs.500.co/jobs/123",
    "https://jobs.techstars.com/jobs/123",
    "https://careers.antler.co/jobs/123",
  ]) {
    const lead = normalizeEcosystemSearchResult({ title: "Product Intern", url, description: "India internship" });
    assert.ok(lead);
    assert.equal(lead.sourceMode, "portfolio_board");
    assert.equal(lead.requiresOfficialEmployerResolution, true);
    assert.equal(lead.applicationPath, "resolve_portfolio_employer_then_safe_fill");
    assert.equal(lead.contactPath, "not_from_portfolio_board");
  }
});

test("official institution careers pages can become direct formal-role leads", () => {
  const lead = normalizeEcosystemSearchResult({
    title: "Investor Relations Analyst 2026 - Blume Ventures",
    url: "https://blume.vc/work-with-us",
    description: "Current openings and careers at Blume",
  });
  assert.ok(lead);
  assert.equal(lead.sourceMode, "direct_institution");
  assert.equal(lead.requiresOfficialEmployerResolution, false);
  assert.equal(lead.applicationPath, "snapshot_official_role_then_safe_fill");
});

test("bootstrap registry is broad but does not act as an allowlist", () => {
  assert.ok(ECOSYSTEM_SOURCES.length >= 14);
  assert.ok(ECOSYSTEM_SOURCES.some((source) => source.institutionType === "accelerator"));
  assert.ok(ECOSYSTEM_SOURCES.some((source) => source.id === "techstars"));
  assert.ok(ECOSYSTEM_SOURCES.some((source) => source.id === "a16z"));
  assert.ok(ECOSYSTEM_SOURCES.some((source) => source.id === "lightspeed"));
  assert.ok(ECOSYSTEM_SOURCES.some((source) => source.id === "khosla"));
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.curatedRegistryIsBootstrapNotAllowlist, true);
});

test("unregistered ecosystem results can surface only as review-required leads", () => {
  const query = ECOSYSTEM_SEARCH_QUERIES.find((item) => item.id === "venture_studios");
  assert.ok(query);
  const lead = normalizeEcosystemSearchResult({
    title: "Venture Studio Analyst Internship",
    url: "https://exampleventurestudio.com/careers/analyst-intern",
    description: "Work with founders on research and business operations.",
  }, query);
  assert.ok(lead);
  assert.equal(lead.sourceMode, "ecosystem_index_lead");
  assert.equal(lead.requiresOfficialSourceRegistration, true);
  assert.equal(lead.requiresOfficialEmployerResolution, true);
  assert.equal(lead.applicationPath, "review_register_source_then_resolve_official_role");
  assert.equal(lead.contactPath, "blocked_until_source_review");
});

test("personal/contact-data brokers and social profiles never become generic trusted ecosystem leads", () => {
  const query = ECOSYSTEM_SEARCH_QUERIES[0];
  for (const url of [
    "https://www.linkedin.com/in/example-investor",
    "https://www.signalhire.com/profiles/example",
    "https://www.apollo.io/people/example",
    "https://www.crunchbase.com/organization/example",
  ]) {
    assert.equal(normalizeEcosystemSearchResult({ title: "Investment analyst internship", url }, query), null);
  }
});

test("search coverage spans capital, startup, accelerator, impact, CVC, founder-office, university and development lanes", () => {
  const lanes = new Set(ECOSYSTEM_SEARCH_QUERIES.map((query) => query.lane));
  for (const lane of [
    "capital_firms",
    "portfolio_talent",
    "accelerators_incubators",
    "venture_studios",
    "impact_health_climate",
    "cvc_innovation",
    "founders_office_startup_ops",
    "university_entrepreneurship",
    "policy_development_finance",
  ]) assert.ok(lanes.has(lane as never), `missing ecosystem lane ${lane}`);
  assert.ok(ECOSYSTEM_SEARCH_QUERIES.length >= 12);
  assert.ok(ECOSYSTEM_ADJACENT_LANES.length >= 15);
});

test("only registered institutions with an explicit official careers surface seed recruiting targets", () => {
  const seeds = buildEcosystemOutreachSeeds();
  assert.ok(seeds.some((seed) => seed.sourceId === "blume"));
  assert.ok(seeds.some((seed) => seed.sourceId === "chiratae"));
  assert.ok(seeds.some((seed) => seed.sourceId === "techstars"));
  assert.ok(seeds.every((seed) => seed.officialUrl.startsWith("https://")));
  assert.ok(seeds.every((seed) => seed.researchFocus.startsWith("[ecosystem:")));
  assert.equal(buildEcosystemOutreachSeeds(["blume.vc"]).some((seed) => seed.sourceId === "blume"), false);
});

test("ecosystem contact research rejects pitch/media/LP/founder inboxes but keeps explicit recruiting evidence", () => {
  const careers = assessEcosystemRecruitingContact({
    email: "careers@example.vc",
    sourceUrl: "https://example.vc/careers",
    excerpt: "For careers and recruiting enquiries email careers@example.vc",
  });
  assert.equal(careers.allowed, true);
  assert.equal(careers.suitability, "high");

  const pitch = assessEcosystemRecruitingContact({
    email: "pitch@example.vc",
    sourceUrl: "https://example.vc/contact",
    excerpt: "Founders should send startup pitches to this inbox.",
  });
  assert.equal(pitch.allowed, false);

  const founderProgram = assessEcosystemRecruitingContact({
    email: "apply@example.com",
    sourceUrl: "https://example.com/founders",
    excerpt: "Founder application and demo day application inbox.",
  });
  assert.equal(founderProgram.allowed, false);

  const generic = assessEcosystemRecruitingContact({
    email: "contact@example.vc",
    sourceUrl: "https://example.vc/contact",
    excerpt: "General business enquiries.",
  });
  assert.equal(generic.allowed, true);
  assert.equal(generic.suitability, "review");
});

test("M13 capability model preserves public-provenance and human-review boundaries", () => {
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.officialSourcesOnly, true);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.unregisteredLeadsRequireReview, true);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.portfolioBoardsLeadOnly, true);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.newContactsNeedReview, true);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.guessEmails, false);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.scrapePersonalContacts, false);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.bypassCaptcha, false);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.sendEmail, false);
  assert.equal(ECOSYSTEM_DISCOVERY_CAPABILITIES.submitApplication, false);
});
