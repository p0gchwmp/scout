import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertSpeculativeCompanyOutreach,
  parseCompanyTargetCreatePayload,
  renderCompanyFirstOutreach,
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

test("company-first routes stay owner-only, same-origin, target-bound and draft-only", async () => {
  const routeFiles = [
    "../app/api/company-outreach/route.ts",
    "../app/api/company-outreach/research/route.ts",
    "../app/api/company-outreach/contacts/route.ts",
    "../app/api/company-outreach/drafts/route.ts",
    "../app/api/company-outreach/gmail-draft/route.ts",
  ];
  for (const relative of routeFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /requireScoutApiUser\(\)/);
    if (!relative.endsWith("company-outreach/route.ts")) assert.match(source, /requireSameOriginMutation\(request\)/);
    assert.doesNotMatch(source, /drafts\.send|messages\.send|submitApplication/);
  }
  const createRoute = await readFile(new URL("../app/api/company-outreach/route.ts", import.meta.url), "utf8");
  assert.match(createRoute, /requireSameOriginMutation\(request\)/);
  const researchRoute = await readFile(new URL("../app/api/company-outreach/research/route.ts", import.meta.url), "utf8");
  assert.match(researchRoute, /parseTargetIdPayload/);
  assert.match(researchRoute, /companyDomain: target\.companyDomain/);
  assert.match(researchRoute, /careersUrl: target\.officialUrl/);
  assert.doesNotMatch(researchRoute, /raw\.companyDomain|payload\.companyDomain|payload\.officialUrl/);
  const gmailRoute = await readFile(new URL("../app/api/company-outreach/gmail-draft/route.ts", import.meta.url), "utf8");
  assert.match(gmailRoute, /eq\(companyOutreachDrafts\.state, "approved"\)/);
  assert.match(gmailRoute, /createGmailDraftThroughAgent/);
});

test("company-first workspace is owner-only and reachable without a fake job record", async () => {
  const page = await readFile(new URL("../app/company-outreach/page.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/company-outreach/company-outreach-client.tsx", import.meta.url), "utf8");
  const root = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requireScoutPageOwner/);
  assert.match(client, /No internship posting\?/);
  assert.match(client, /Find published HR \/ recruiting contacts/);
  assert.match(client, /No job opening was invented/);
  assert.match(root, /Company Outreach/);
  assert.match(root, /\/company-outreach/);
});

test("company-first migration preserves accepted-contact and approved-claim boundaries", async () => {
  const migration = await readFile(new URL("../drizzle/0011_company_outreach_targets.sql", import.meta.url), "utf8");
  assert.match(migration, /company_outreach_targets/);
  assert.match(migration, /company_outreach_contacts/);
  assert.match(migration, /company_outreach_draft_revisions/);
  assert.match(migration, /review_state` = 'accepted'/);
  assert.match(migration, /claim\.`status` <> 'approved'/);
  assert.match(migration, /approved company outreach drafts are immutable/);
});
