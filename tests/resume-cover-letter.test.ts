import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseResumeImportPayload } from "../lib/scout/resume-import.ts";
import { combineOutreachAndCoverLetter, renderCoverLetter, splitOutreachBundle } from "../lib/scout/cover-letter.ts";

test("resume import stays draft/unverified by contract and rejects duplicate profile kinds", () => {
  const parsed = parseResumeImportPayload({
    schemaVersion: 1,
    resumeReference: "resume.pdf",
    acknowledgeDraftOnly: true,
    profile: [
      { kind: "full_name", claim: "Ryan Example" },
      { kind: "program", claim: "B.S. Management and Public Policy" },
    ],
    claims: [
      { statement: "Designed an exploratory public-health pilot." },
      { statement: "Guided AI-assisted prototyping and workflow testing." },
    ],
  });
  assert.equal(parsed.acknowledgeDraftOnly, true);
  assert.match(parsed.profile[0].evidence, /User-approved resume: resume\.pdf/);
  assert.throws(() => parseResumeImportPayload({
    schemaVersion: 1,
    resumeReference: "resume.pdf",
    acknowledgeDraftOnly: true,
    profile: [
      { kind: "full_name", claim: "Ryan Example" },
      { kind: "full_name", claim: "Ryan Example" },
    ],
    claims: [{ statement: "One claim" }],
  }), /unique/);
});

test("policy/public-health cover letters prefer policy evidence and use no more than two claims", () => {
  const rendered = renderCoverLetter({
    candidateName: "Ryan Example",
    companyName: "Policy Lab",
    roleTitle: "Public Policy Intern",
    purpose: "formal_role",
    opportunityContext: "Research district-level healthcare implementation and policy-to-practice gaps.",
    profile: { university: "IIM Sambalpur", program: "B.S. Management and Public Policy" },
    claims: [
      { id: "copium", statement: "Co-founded a botanical soda venture and developed a campus-first validation strategy." },
      { id: "nhm", statement: "Designed a single-site exploratory public-health pilot on hand-hygiene awareness, access, practice and policy-to-practice gaps." },
      { id: "gmc", statement: "Reviewed adverse-drug-reaction data and researched antibiotic price disparities within the pharmacovigilance ecosystem." },
    ],
  });
  assert.deepEqual(rendered.claimIds, ["nhm", "gmc"]);
  assert.doesNotMatch(rendered.body, /Copium|botanical soda/i);
  assert.doesNotMatch(rendered.body, /\[\[/);
});

test("product/startup cover letters prefer product/startup evidence and bundle inline for Gmail review", () => {
  const rendered = renderCoverLetter({
    candidateName: "Ryan Example",
    companyName: "Acme",
    roleTitle: "Product Operations Intern",
    purpose: "formal_role",
    opportunityContext: "Work across product, operations, testing and customer workflows.",
    profile: { university: "IIM Sambalpur", program: "B.S. Management and Public Policy" },
    claims: [
      { id: "nhm", statement: "Designed a public-health pilot and facility-readiness checklist." },
      { id: "aastha", statement: "Translated multi-clinic operating workflows into product requirements and validated an AI-assisted prototype with automated tests." },
      { id: "copium", statement: "Co-founded a botanical soda venture and developed the initial product concept and campus-first validation strategy." },
    ],
  });
  assert.deepEqual(rendered.claimIds, ["aastha", "copium"]);
  const combined = combineOutreachAndCoverLetter(
    "To: careers@acme.example\nSubject: Product Operations Intern at Acme\n\nHi recruiting team,\n\nI am interested in the role.\n\nBest,\nRyan Example",
    rendered.body,
  );
  const split = splitOutreachBundle(combined);
  assert.match(split.emailDraft, /^To: careers@acme\.example/);
  assert.match(split.coverLetter ?? "", /Dear Hiring Team/);
  assert.match(combined, /---\nCover letter\n/);
});


test("resume import route and page preserve owner and same-origin gates", async () => {
  const route = await readFile(new URL("../app/api/resume-import/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/resume-import/page.tsx", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(/);
  assert.match(route, /requireSameOriginMutation\(/);
  assert.match(route, /verified:\s*false/);
  assert.match(route, /status:\s*"draft"/);
  assert.doesNotMatch(route, /sendEmail\s*:\s*true|submitApplication\s*:\s*true/);
  assert.match(page, /requireScoutPageOwner\(/);
});

test("job and company outreach revisions include a cover letter before Gmail draft creation", async () => {
  const companyRoute = await readFile(new URL("../app/api/company-outreach/drafts/route.ts", import.meta.url), "utf8");
  const jobRoute = await readFile(new URL("../app/api/agent/draft-outreach/auto/route.ts", import.meta.url), "utf8");
  const directRoute = await readFile(new URL("../app/api/outreach/route.ts", import.meta.url), "utf8");
  for (const source of [companyRoute, jobRoute, directRoute]) {
    assert.match(source, /renderCoverLetter\(/);
    assert.match(source, /combineOutreachAndCoverLetter\(/);
    assert.match(source, /claimIds/);
  }
  assert.match(companyRoute, /purpose:\s*"speculative_company"/);
  assert.match(jobRoute, /purpose:\s*"formal_role"/);
  assert.match(directRoute, /purpose:\s*"formal_role"/);
});
