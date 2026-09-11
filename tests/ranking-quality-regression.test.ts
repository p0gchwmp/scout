import assert from "node:assert/strict";
import test from "node:test";
import { cleanJobText } from "../lib/scout/job-text.ts";
import { evaluateResumeAlignment } from "../lib/scout/resume-alignment.ts";
import { classifyRoleTaxonomy } from "../lib/scout/role-taxonomy.ts";
import { evaluateShortlist } from "../lib/scout/shortlist-intelligence.ts";

const claims = [
  {
    id: "claim-product",
    statement: "Translated clinic operations into product requirements, workflows, billing rules and audit-trail requirements.",
    evidence: "Approved product and operations requirements evidence.",
    status: "approved" as const,
  },
  {
    id: "claim-systems",
    statement: "Guided AI-assisted implementation of a Node.js, Express and SQLite operations prototype with workflow testing.",
    evidence: "Approved prototype, implementation and workflow-testing evidence.",
    status: "approved" as const,
  },
  {
    id: "claim-research",
    statement: "Reviewed adverse-drug-reaction data and technical documentation and completed desk research.",
    evidence: "Approved research, data-review and documentation evidence.",
    status: "approved" as const,
  },
  {
    id: "claim-business",
    statement: "Co-founded a botanical soda venture and helped shape product strategy, market validation and a campus-first launch approach.",
    evidence: "Approved business, strategy and market-validation evidence.",
    status: "approved" as const,
  },
  {
    id: "claim-finance",
    statement: "Researched antibiotic price disparities and implications for healthcare access.",
    evidence: "Approved price research evidence.",
    status: "approved" as const,
  },
  {
    id: "claim-draft",
    statement: "Professional security infrastructure engineer.",
    evidence: "Unreviewed.",
    status: "draft" as const,
  },
];

const now = new Date("2026-09-11T00:00:00Z");

function job(overrides: Partial<Parameters<typeof evaluateShortlist>[0]> = {}) {
  return {
    title: "Product Ops Intern",
    description: "Own product workflows, requirements, operational analysis, integrations and documentation.",
    location: "Bengaluru, India",
    workplaceType: "on-site",
    postedAt: "2026-09-10T00:00:00Z",
    currentSnapshotId: "snapshot-1",
    eligibilityRisks: [] as string[],
    ...overrides,
  };
}

test("production regression: security infrastructure engineering stays a stretch role", () => {
  const taxonomy = classifyRoleTaxonomy({
    title: "Security Infrastructure Engineer Intern",
    description: "Build cloud infrastructure, APIs, automation, testing and production systems.",
  });
  assert.equal(taxonomy.preferenceLane, "software_stretch");

  const alignment = evaluateResumeAlignment(job({
    title: "Security Infrastructure Engineer Intern",
    description: "&lt;p&gt;Build cloud infrastructure, APIs, automation, testing and production systems.&lt;/p&gt;",
    location: "Remote",
  }), claims);
  assert.equal(alignment.band, "stretch");
  assert.ok(!alignment.supportingClaims.some((support) => support.claimIds.includes("claim-draft")));
});

test("production regression: payroll and benefits does not become strong from generic company boilerplate", () => {
  const alignment = evaluateResumeAlignment(job({
    title: "Payroll, Compensation & Benefits Intern",
    description: "&lt;p&gt;Our technology company uses data, analytics, product operations, systems, workflows, quality reviews and technical documentation.&lt;/p&gt;",
    location: "Bogota, Colombia",
    workplaceType: "remote",
  }), claims);
  assert.notEqual(alignment.band, "strong");
});

test("production regression: technical-primary title edges cannot become strong from adjacent evidence", () => {
  const itSupport = evaluateResumeAlignment(job({
    title: "IT Intern – Gadget & Tech Support Operations",
    description: "Support internal operations, workflows, systems, documentation and stakeholder requests.",
  }), claims);
  assert.equal(itSupport.band, "stretch");

  const analyticsEngineer = evaluateResumeAlignment(job({
    title: "Analytics Engineer Intern",
    description: "Build analytics workflows, data reporting, systems integrations and automated quality checks.",
  }), claims);
  assert.equal(analyticsEngineer.band, "stretch");
});

test("production regression: pure marketing and communications stays outside the target lane", () => {
  const marketingComms = evaluateResumeAlignment(job({
    title: "Marketing Growth & Communications Intern",
    description: "Support growth strategy, market research, campaign analysis, operations and stakeholder coordination.",
  }), claims);
  assert.equal(marketingComms.band, "stretch");

  const marketingAnalyticsOps = evaluateResumeAlignment(job({
    title: "Marketing Growth Analytics & Operations Intern",
    description: "Own operations analytics, market reporting, workflow analysis and growth strategy.",
  }), claims);
  assert.notEqual(marketingAnalyticsOps.band, "stretch");
});

test("production regression: product ops and strategy ops retain strong title-led evidence overlap", () => {
  const product = evaluateResumeAlignment(job(), claims);
  assert.equal(product.band, "strong");

  const strategy = evaluateResumeAlignment(job({
    title: "GTM Strategy & Operations Intern",
    description: "Support market research, operating cadence and growth experiments.",
    location: "Remote",
    workplaceType: "remote",
  }), claims);
  assert.equal(strategy.band, "strong");
});

test("supporting evidence is capped per theme while exact immutable claim ids remain intact", () => {
  const alignment = evaluateResumeAlignment(job({
    description: "Product operations, workflows, analysis, data, research, implementation, systems, testing, documentation, strategy and support.",
  }), claims);
  assert.ok(alignment.supportingClaims.length > 0);
  assert.ok(alignment.supportingClaims.every((support) => support.claimIds.length <= 3));
  assert.ok(alignment.supportingClaims.flatMap((support) => support.claimIds).every((id) => claims.some((claim) => claim.id === id)));
});

test("encoded ATS markup is decoded and stripped before matching or presentation", () => {
  assert.equal(
    cleanJobText("&lt;p&gt;About &amp;amp; role&lt;/p&gt;&lt;strong&gt;Product Ops&lt;/strong&gt;"),
    "About & role Product Ops",
  );
});

test("country-scoped foreign remote is materially downranked versus India and open remote", () => {
  const india = evaluateShortlist(job(), claims, now);
  const openRemote = evaluateShortlist(job({ location: "Remote", workplaceType: "remote" }), claims, now);
  const colombiaRemote = evaluateShortlist(job({ location: "Bogota, Colombia", workplaceType: "remote" }), claims, now);

  assert.equal(india.targetGeographyLane, "india");
  assert.equal(openRemote.targetGeographyLane, "open_remote");
  assert.equal(colombiaRemote.targetGeographyLane, "scoped_elsewhere");
  assert.ok(india.score > colombiaRemote.score);
  assert.ok(openRemote.score > colombiaRemote.score);
  assert.ok(colombiaRemote.priority === "consider" || colombiaRemote.priority === "low");
});
