import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deterministicDraft = await readFile(new URL("../app/api/outreach/route.ts", import.meta.url), "utf8");
const aiDraft = await readFile(new URL("../app/api/agent/draft-outreach/route.ts", import.meta.url), "utf8");
const roleGmail = await readFile(new URL("../app/api/agent/create-gmail-draft/route.ts", import.meta.url), "utf8");
const companyGmail = await readFile(new URL("../app/api/company-outreach/gmail-draft/route.ts", import.meta.url), "utf8");

test("role outreach creation resolves candidate identity from verified full_name evidence", () => {
  assert.match(deterministicDraft, /verifiedOutreachCandidateName/);
  assert.match(deterministicDraft, /profileEvidence\.kind, "full_name"/);
  assert.doesNotMatch(deterministicDraft, /candidateName[^\n]+return raw/);
  assert.match(aiDraft, /verifiedOutreachCandidateName\(voiceRows, payload\.candidateName\)/);
  assert.match(aiDraft, /candidateName,/);
  assert.doesNotMatch(aiDraft, /candidateName: payload\.candidateName/);
});

for (const [label, route] of [["role", roleGmail], ["company-first", companyGmail]] as const) {
  test(`${label} Gmail draft creation rechecks verified identity freshness before external draft creation`, () => {
    assert.match(route, /profileEvidence/);
    assert.match(route, /profileEvidence\.kind, "full_name"/);
    assert.match(route, /outreachIdentityExecutionIssues/);
    assert.match(route, /revisionCreatedAt: revision\.createdAt/);
    assert.match(route, /executionIssues/);
    assert.ok(route.indexOf("outreachIdentityExecutionIssues") < route.indexOf("const result = await createGmailDraftThroughAgent"));
  });
}

test("M12 preserves draft-only external capability", () => {
  const joined = `${deterministicDraft}\n${aiDraft}\n${roleGmail}\n${companyGmail}`;
  assert.match(roleGmail, /sendEmail: false/);
  assert.match(roleGmail, /submitApplication: false/);
  assert.doesNotMatch(joined, /sendEmail\s*:\s*true|submitApplication\s*:\s*true|messages\.send|drafts\.send|\/v1\/send/);
});
