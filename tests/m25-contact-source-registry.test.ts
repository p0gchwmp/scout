import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_CONTACT_CRAWL_SEEDS,
  classifyOfficialContactSource,
  isOfficialContactResearchLink,
  officialContactSourceScoreBonus,
} from "../lib/scout/contact-source-registry.ts";

test("official contact registry classifies supported first-party provenance surfaces", () => {
  assert.equal(classifyOfficialContactSource(new URL("https://acme.example/jobs/123-product-intern")), "official_job_posting");
  assert.equal(classifyOfficialContactSource(new URL("https://acme.example/careers")), "official_careers");
  assert.equal(classifyOfficialContactSource(new URL("https://careers.acme.example/openings")), "official_careers");
  assert.equal(classifyOfficialContactSource(new URL("https://acme.example/events/campus-hiring")), "official_event");
  assert.equal(classifyOfficialContactSource(new URL("https://acme.example/team")), "official_team");
  assert.equal(classifyOfficialContactSource(new URL("https://acme.example/contact-us")), "official_contact");
  assert.equal(classifyOfficialContactSource(new URL("https://acme.example/press/graduate-program")), "official_press");
  assert.equal(classifyOfficialContactSource(new URL("https://acme.example/about")), "official_company");
});

test("crawl seed registry expands useful official surfaces without embedding third-party hosts", () => {
  assert.equal(new Set(OFFICIAL_CONTACT_CRAWL_SEEDS).size, OFFICIAL_CONTACT_CRAWL_SEEDS.length);
  for (const path of ["/careers", "/jobs", "/early-careers", "/internships", "/events", "/team", "/contact", "/press", "/about", "/"]) {
    assert.ok(OFFICIAL_CONTACT_CRAWL_SEEDS.includes(path), `${path} missing from registry`);
  }
  assert.ok(OFFICIAL_CONTACT_CRAWL_SEEDS.every((path) => path.startsWith("/") && !path.includes("://")));
});

test("only registered provenance surfaces and about pages are research-link relevant", () => {
  assert.equal(isOfficialContactResearchLink(new URL("https://acme.example/events/campus")), true);
  assert.equal(isOfficialContactResearchLink(new URL("https://acme.example/press/hiring")), true);
  assert.equal(isOfficialContactResearchLink(new URL("https://acme.example/team")), true);
  assert.equal(isOfficialContactResearchLink(new URL("https://acme.example/about")), true);
  assert.equal(isOfficialContactResearchLink(new URL("https://acme.example/privacy")), false);
  assert.equal(isOfficialContactResearchLink(new URL("https://acme.example/blog/random")), false);
});

test("source confidence bonuses remain bounded and provenance-sensitive", () => {
  assert.ok(officialContactSourceScoreBonus("official_job_posting") > officialContactSourceScoreBonus("official_careers"));
  assert.ok(officialContactSourceScoreBonus("official_careers") > officialContactSourceScoreBonus("official_contact"));
  assert.ok(officialContactSourceScoreBonus("official_event") > officialContactSourceScoreBonus("official_press"));
  assert.equal(officialContactSourceScoreBonus("official_company"), 0);
  assert.equal(officialContactSourceScoreBonus("unknown"), 0);
});
