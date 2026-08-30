import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/ecosystem/route.ts", import.meta.url), "utf8");
const helper = await readFile(new URL("../lib/scout/ecosystem-discovery.ts", import.meta.url), "utf8");

test("ecosystem API is owner-only and browser mutations are same-origin", () => {
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
});

test("ecosystem contact research reuses provenance-first company outreach tables and defaults to needs_review", () => {
  assert.match(route, /researchPublishedCompanyContacts/);
  assert.match(route, /companyOutreachTargets/);
  assert.match(route, /companyOutreachContacts/);
  assert.match(route, /assessEcosystemRecruitingContact/);
  assert.match(route, /reviewState: "needs_review"/);
  assert.match(route, /sourceUrl: candidate\.sourceUrl/);
  assert.match(route, /excerpt: candidate\.excerpt/);
});

test("search-index ecosystem discovery stays ephemeral and unregistered sources stay review-only", () => {
  assert.match(route, /persistedSearchResults: false/);
  assert.match(route, /curatedRegistryIsBootstrapNotAllowlist: true/);
  assert.match(helper, /requiresOfficialSourceRegistration: true/);
  assert.match(helper, /review_register_source_then_resolve_official_role/);
  assert.match(helper, /blocked_until_source_review/);
  assert.doesNotMatch(route, /insert\(jobs\)|insert\(jobSnapshots\)/);
});

test("portfolio discovery remains lead-only until the portfolio employer is resolved", () => {
  assert.match(helper, /requiresOfficialEmployerResolution: true/);
  assert.match(helper, /resolve_portfolio_employer_then_safe_fill/);
  assert.match(helper, /not_from_portfolio_board/);
});

test("M13 breadth is not hard-limited to a handful of VCs", () => {
  assert.match(helper, /accelerators_incubators/);
  assert.match(helper, /venture_studios/);
  assert.match(helper, /angels_family_offices/);
  assert.match(helper, /impact_health_climate/);
  assert.match(helper, /cvc_innovation/);
  assert.match(helper, /growth_private_equity/);
  assert.match(helper, /founders_office_startup_ops/);
  assert.match(helper, /university_entrepreneurship/);
  assert.match(helper, /policy_development_finance/);
  assert.match(helper, /startup_networks/);
});

test("M13 adds no auto-send, private-contact scraping, CAPTCHA bypass or application submit", () => {
  const joined = `${route}\n${helper}`;
  assert.match(joined, /sendEmail: false/);
  assert.match(joined, /submitApplication: false/);
  assert.match(joined, /guessEmails: false/);
  assert.match(joined, /scrapePersonalContacts: false/);
  assert.match(joined, /bypassCaptcha: false/);
  assert.doesNotMatch(joined, /messages\.send|drafts\.send|submitApplication\s*:\s*true|sendEmail\s*:\s*true/);
});
