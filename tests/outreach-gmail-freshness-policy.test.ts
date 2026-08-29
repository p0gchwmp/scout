import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const roleRoute = await readFile(new URL("../app/api/agent/create-gmail-draft/route.ts", import.meta.url), "utf8");
const companyRoute = await readFile(new URL("../app/api/company-outreach/gmail-draft/route.ts", import.meta.url), "utf8");

for (const [label, route] of [["role outreach", roleRoute], ["company-first outreach", companyRoute]] as const) {
  test(`${label} revalidates approved evidence before invoking the Gmail draft agent`, () => {
    assert.match(route, /parsePinnedOutreachClaimIds/);
    assert.match(route, /selectUsableApprovedClaims/);
    assert.match(route, /parseOutreachDraftForEmail/);
    assert.match(route, /hashDraftBody/);
    assert.match(route, /bindingIssues/);
    assert.match(route, /status: 409/);
    assert.ok(route.indexOf("const bindingIssues") < route.indexOf("const result = await createGmailDraftThroughAgent"));
  });
}

test("role outreach rechecks current job snapshot and accepted pinned contact before Gmail draft creation", () => {
  assert.match(roleRoute, /jobs/);
  assert.match(roleRoute, /contactEvidence/);
  assert.match(roleRoute, /currentJobSnapshotId: job\?\.currentSnapshotId/);
  assert.match(roleRoute, /revisionJobSnapshotId: revision\.jobSnapshotId/);
  assert.match(roleRoute, /revisionContactId: revision\.contactId/);
  assert.match(roleRoute, /currentUsableClaimIds/);
});

test("company-first outreach rechecks active target and accepted pinned contact before Gmail draft creation", () => {
  assert.match(companyRoute, /companyOutreachContacts/);
  assert.match(companyRoute, /targetState: target\.state/);
  assert.match(companyRoute, /revisionTargetId: revision\.targetId/);
  assert.match(companyRoute, /revisionContactId: revision\.contactId/);
  assert.match(companyRoute, /currentUsableClaimIds/);
});

test("M11 Gmail routes remain draft-only and expose no send or application-submit path", () => {
  assert.match(roleRoute, /sendEmail: false/);
  assert.match(roleRoute, /submitApplication: false/);
  const joined = `${roleRoute}\n${companyRoute}`;
  assert.doesNotMatch(joined, /sendEmail\s*:\s*true|submitApplication\s*:\s*true|messages\.send|drafts\.send|\/v1\/send/);
  assert.doesNotMatch(companyRoute, /submitApplication/);
});
