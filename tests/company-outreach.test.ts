import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildCompanyAutopilotQueue } from "../lib/scout/company-autopilot.ts";
import {
  assertSpeculativeCompanyOutreach,
  parseCompanyTargetCreatePayload,
  renderCompanyFirstOutreach,
  selectCompanyOutreachClaimIds,
} from "../lib/scout/company-outreach.ts";

test("company-first targets require an official same-domain HTTPS page", () => {
  const parsed = parseCompanyTargetCreatePayload({
    companyName: "Example Co",
    companyDomain: "example.com",
    officialUrl: "https://careers.example.com/early-careers",
    track: "now_remote",
    interestNote: "I like the product's consumer focus.",
  });
  assert.equal(parsed.companyDomain, "example.com");
  assert.equal(parsed.track, "now_remote");
  assert.throws(() => parseCompanyTargetCreatePayload({
    companyName: "Example Co",
    companyDomain: "example.com",
    officialUrl: "https://linkedin.com/company/example",
    track: "now_remote",
  }), /official company URL|declared company domain/i);
  assert.throws(() => parseCompanyTargetCreatePayload({
    companyName: "Example Co",
    companyDomain: "example.com",
    officialUrl: "https://evil.example.net/",
    track: "summer_2027",
  }), /declared company domain/i);
});

test("company-first drafting is explicitly speculative and uses only selected claims", () => {
  const rendered = renderCompanyFirstOutreach({
    candidateName: "Ryan",
    companyName: "Example Co",
    track: "summer_2027",
    interestNote: null,
    contactEmail: "careers@example.com",
    claims: [
      { id: "claim-a", statement: "Built a clinic operations prototype with workflow mapping and automated tests." },
      { id: "claim-b", statement: "Reviewed adverse-drug-reaction data and technical documentation." },
    ],
  });
  assert.deepEqual(rendered.claimIds, ["claim-a", "claim-b"]);
  assert.match(rendered.body, /21 May/);
  assert.match(rendered.body, /may not be a formal opening/i);
  assert.doesNotMatch(rendered.body, /I came across the .*opening/i);
  assert.equal(assertSpeculativeCompanyOutreach(rendered.body), rendered.body);
  assert.throws(() => assertSpeculativeCompanyOutreach("I came across the job posting and want to apply."), /must not claim a formal opening/i);
});

test("autopilot ranks controlled companies and automatic claims without inventing evidence", () => {
  const queue = buildCompanyAutopilotQueue({
    sources: [{ id: "source-a", companyName: "Example Health", companyDomain: "examplehealth.com", enabled: true }],
    jobs: [{
      id: "job-a",
      sourceRegistryId: "source-a",
      company: "Example Health",
      title: "Product Operations Intern",
      description: "Remote internship supporting healthcare workflow operations.",
      location: "Remote India",
      workplaceType: "remote",
      score: 80,
      lifecycleState: "active",
    }],
    limit: 3,
  });
  assert.equal(queue[0].companyDomain, "examplehealth.com");
  assert.equal(queue[0].track, "now_remote");
  assert.ok(queue[0].priorityScore > 40);

  const claimIds = selectCompanyOutreachClaimIds({
    companyName: "Example Health",
    researchFocus: "healthcare product operations workflow",
    track: "now_remote",
    claims: [
      { id: "clinic", statement: "Built a clinic operations prototype with workflow mapping and automated tests." },
      { id: "policy", statement: "Analysed public-policy governance frameworks." },
    ],
  });
  assert.equal(claimIds[0], "clinic");
  assert.ok(claimIds.length <= 3);
});

test("company-first routes stay owner-only, same-origin, target-bound and draft-only", async () => {
  const routeFiles = [
    "../app/api/company-outreach/route.ts",
    "../app/api/company-outreach/autopilot/route.ts",
    "../app/api/company-outreach/research/route.ts",
    "../app/api/company-outreach/contacts/route.ts",
    "../app/api/company-outreach/drafts/route.ts",
    "../app/api/company-outreach/gmail-draft/route.ts",
  ];
  for (const relative of routeFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /requireScoutApiUser\(\)/);
    assert.match(source, /requireSameOriginMutation\(request\)/);
    assert.doesNotMatch(source, /drafts\.send|messages\.send|submitApplication/);
  }
  const researchRoute = await readFile(new URL("../app/api/company-outreach/research/route.ts", import.meta.url), "utf8");
  assert.match(researchRoute, /parseTargetIdPayload/);
  assert.match(researchRoute, /companyDomain: target\.companyDomain/);
  assert.match(researchRoute, /careersUrl: target\.officialUrl/);
  assert.match(researchRoute, /createAgentSearchProvider/);
  assert.doesNotMatch(researchRoute, /raw\.companyDomain|payload\.companyDomain|payload\.officialUrl/);
  const autopilotRoute = await readFile(new URL("../app/api/company-outreach/autopilot/route.ts", import.meta.url), "utf8");
  assert.match(autopilotRoute, /buildCompanyAutopilotQueue/);
  assert.doesNotMatch(autopilotRoute, /request\.json\(\)/);
  assert.match(autopilotRoute, /reviewState: "needs_review"/);
  const gmailRoute = await readFile(new URL("../app/api/company-outreach/gmail-draft/route.ts", import.meta.url), "utf8");
  assert.match(gmailRoute, /eq\(companyOutreachDrafts\.state, "approved"\)/);
  assert.match(gmailRoute, /createGmailDraftThroughAgent/);
});

test("company-first workspace is owner-only and autopilot is reachable from the unified review queue", async () => {
  const page = await readFile(new URL("../app/company-outreach/page.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/company-outreach/company-outreach-client.tsx", import.meta.url), "utf8");
  const reviewPage = await readFile(new URL("../app/review/page.tsx", import.meta.url), "utf8");
  const autopilotPanel = await readFile(new URL("../app/review/autopilot-panel.tsx", import.meta.url), "utf8");
  const root = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requireScoutPageOwner/);
  assert.match(client, /No internship posting\?/);
  assert.match(client, /Find published HR \/ recruiting contacts/);
  assert.match(reviewPage, /AutopilotPanel/);
  assert.match(autopilotPanel, /Run Scout/);
  assert.match(autopilotPanel, /\/api\/agent\/discover/);
  assert.match(autopilotPanel, /\/api\/company-outreach\/autopilot/);
  assert.match(root, /Company Outreach/);
});

test("review autopilot reports non-JSON responses without leaking raw server bodies", async () => {
  const autopilotPanel = await readFile(new URL("../app/review/autopilot-panel.tsx", import.meta.url), "utf8");
  assert.match(autopilotPanel, /headers\.set\("accept", "application\/json"\)/);
  assert.match(autopilotPanel, /response\.text\(\)/);
  assert.match(autopilotPanel, /content-type/);
  assert.match(autopilotPanel, /Promise\.allSettled/);
  assert.match(autopilotPanel, /returned invalid JSON/);
  assert.match(autopilotPanel, /returned HTTP \$\{response\.status\} without JSON/);
  assert.doesNotMatch(autopilotPanel, /response\.json\(\)/);
  assert.doesNotMatch(autopilotPanel, /throw new Error\(text\)/);
});

test("company-first migrations preserve evidence boundaries and add autopilot provenance", async () => {
  const baseMigration = await readFile(new URL("../drizzle/0011_company_outreach_targets.sql", import.meta.url), "utf8");
  const autopilotMigration = await readFile(new URL("../drizzle/0012_company_outreach_autopilot.sql", import.meta.url), "utf8");
  assert.match(baseMigration, /company_outreach_targets/);
  assert.match(baseMigration, /company_outreach_contacts/);
  assert.match(baseMigration, /company_outreach_draft_revisions/);
  assert.match(baseMigration, /review_state` = 'accepted'/);
  assert.match(baseMigration, /claim\.`status` <> 'approved'/);
  assert.match(baseMigration, /approved company outreach drafts are immutable/);
  assert.match(autopilotMigration, /origin/);
  assert.match(autopilotMigration, /research_focus/);
  assert.match(autopilotMigration, /source_context/);
});
