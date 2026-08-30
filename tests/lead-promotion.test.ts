import assert from "node:assert/strict";
import test from "node:test";
import {
  LEAD_PROMOTION_CAPABILITIES,
  leadPromotionIdempotencyKey,
  parseLeadPromotionPayload,
  requiresEmployerHint,
} from "../lib/scout/lead-promotion.ts";

test("M15 accepts a bounded explicit lead-promotion request", () => {
  assert.deepEqual(parseLeadPromotionPayload({
    action: "resolve_promote",
    leadUrl: "https://jobs.example.vc/jobs/role-1",
    companyHint: "Example Startup",
    title: "Product Intern",
    sourceMode: "portfolio_board",
  }), {
    action: "resolve_promote",
    leadUrl: "https://jobs.example.vc/jobs/role-1",
    companyHint: "Example Startup",
    title: "Product Intern",
    sourceMode: "portfolio_board",
  });
});

test("M15 rejects non-HTTPS or missing employer evidence hints", () => {
  assert.throws(() => parseLeadPromotionPayload({ action: "resolve_promote", leadUrl: "http://example.com/job", companyHint: "Example", title: "Intern", sourceMode: "portfolio_board" }), /HTTPS/);
  assert.throws(() => parseLeadPromotionPayload({ action: "resolve_promote", leadUrl: "https://example.com/job", companyHint: "", title: "Intern", sourceMode: "portfolio_board" }), /Employer\/company/);
});

test("M15 makes portfolio and unregistered ecosystem leads require employer hints", () => {
  assert.equal(requiresEmployerHint("direct_institution"), false);
  assert.equal(requiresEmployerHint("portfolio_board"), true);
  assert.equal(requiresEmployerHint("ecosystem_index_lead"), true);
});

test("M15 idempotency is tied to official external id and content hash", () => {
  assert.equal(leadPromotionIdempotencyKey("12345", "abcdef1234567890abcdef1234567890"), "lead-promotion:12345:abcdef1234567890abcdef12");
});

test("M15 capabilities preserve execution and privacy boundaries", () => {
  assert.equal(LEAD_PROMOTION_CAPABILITIES.persistSearchSnippet, false);
  assert.equal(LEAD_PROMOTION_CAPABILITIES.officialAtsRefetchRequired, true);
  assert.equal(LEAD_PROMOTION_CAPABILITIES.autoRegisterVerifiedAtsSource, true);
  assert.equal(LEAD_PROMOTION_CAPABILITIES.autoTrustUnknownEcosystemSource, false);
  assert.equal(LEAD_PROMOTION_CAPABILITIES.sendEmail, false);
  assert.equal(LEAD_PROMOTION_CAPABILITIES.submitApplication, false);
});
