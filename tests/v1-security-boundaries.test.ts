import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function includesAll(text: string, values: readonly string[]) {
  for (const value of values) assert.ok(text.includes(value), `missing V1 invariant marker: ${value}`);
}

test("owner auth fails closed and browser mutations enforce same origin", () => {
  const text = source("app/scout-api.ts");
  includesAll(text, [
    'SCOUT_OWNER_CONFIGURATION_ERROR = "Scout owner is not configured"',
    'if (!ownerId) return scoutPublicError(SCOUT_OWNER_CONFIGURATION_ERROR, 503)',
    'if (user.userId !== ownerId) return scoutPublicError("Forbidden", 403)',
    'SCOUT_PUBLIC_ORIGIN',
    'const expectedOrigin = canonicalMutationOrigin(requestUrl)',
    'if (!expectedOrigin) return scoutPublicError(SCOUT_CROSS_ORIGIN_ERROR, 403)',
    'originUrl.origin !== expectedOrigin',
    'fetchSite.toLowerCase() !== "same-origin"',
  ]);
});

test("database keeps snapshots, approved claims, contact provenance and outreach revisions immutable", () => {
  const migration = source("drizzle/0001_scout_vertical.sql");
  includesAll(migration, [
    "job_snapshots_immutable_update",
    "job_snapshots_immutable_delete",
    "candidate_claims_approved_immutable_update",
    "candidate_claims_approved_immutable_delete",
    "contact_evidence_provenance_immutable",
    "outreach_revisions_immutable_update",
    "outreach_revisions_require_current_accepted_evidence",
    "outreach_drafts_approval_revalidate",
  ]);
});

test("Safe Fill exchange revalidates snapshot, profile and approved claim bindings and still cannot submit", () => {
  const text = source("app/api/applications/browser-task/exchange/route.ts");
  includesAll(text, [
    "applicationPacketMatchesCurrentSnapshot",
    "applicationPacketProfileBindingIssues",
    'claims.every((claim) => claim.status === "approved")',
    "aiAnswersRequireExplicitApprovalBeforeFill: true",
    "solveCaptcha: false",
    "submitApplication: false",
  ]);
});

test("Gmail draft creation revalidates approved outreach evidence and verified identity", () => {
  const text = source("app/api/agent/create-gmail-draft/route.ts");
  includesAll(text, [
    'eq(outreachDrafts.state, "approved")',
    "jobOutreachExecutionIssues",
    "outreachIdentityExecutionIssues",
    "hashDraftBody(revision.body)",
    "sendEmail: false",
    "submitApplication: false",
  ]);
});

test("one-run orchestration preserves human trust decisions", () => {
  const text = source("app/api/agent/orchestrate/route.ts");
  includesAll(text, [
    "requireScoutApiUser",
    "requireSameOriginMutation",
    "persistedSearchResults: false",
    "deferredToDedicatedResearch: true",
    "autoPromotePortfolioLead: false",
    "autoAcceptContact: false",
    "createGmailDraft: false",
    "sendEmail: false",
    "submitApplication: false",
  ]);
  assert.doesNotMatch(text, /researchPublishedCompanyContacts|insert\(companyOutreachContacts\)/);
});

test("ecosystem discovery does not convert search snippets or guessed/private contacts into trusted evidence", () => {
  const text = source("app/api/ecosystem/route.ts");
  includesAll(text, [
    "persistedSearchResults: false",
    'reviewState: "needs_review"',
    "guessEmails: false",
    "scrapePersonalContacts: false",
    "submitApplication: false",
  ]);
});

test("Scout CI protects both the release and development branches and runs the complete release gate", () => {
  const workflow = source(".github/workflows/scout-ci.yml");
  const pkg = JSON.parse(source("package.json")) as { scripts?: Record<string, string> };
  const cleanScript = source("scripts/assert-clean-worktree.mjs");
  includesAll(workflow, ["- main", "- feat/discovery-contact-mvp", "npm run verify:release"]);
  assert.ok(pkg.scripts?.["verify:release"]?.includes("npm test"));
  assert.ok(pkg.scripts?.["verify:release"]?.includes("npm run lint"));
  assert.ok(pkg.scripts?.["verify:release"]?.includes("migration-smoke.py"));
  assert.ok(pkg.scripts?.["verify:release"]?.includes("company-outreach-migration-smoke.py"));
  assert.ok(pkg.scripts?.["verify:release"]?.includes("npm run db:generate"));
  assert.ok(pkg.scripts?.["verify:release"]?.includes("npm run check:clean"));
  assert.ok(pkg.scripts?.["verify:release"]?.includes("npm run build"));
  assert.ok(pkg.scripts?.["verify:release"]?.includes("git diff --check"));
  includesAll(cleanScript, ["git", "status", "--porcelain", "--untracked-files=all", "process.exit(1)"]);
});

test("v1 contact research stays first-party and rejects broad personal mailbox harvesting", () => {
  const text = source("agent/contact-research.ts");
  includesAll(text, [
    "thirdPartyPublicPageFetch: false",
    "namedBusinessMailboxRequiresRecruitingContext: true",
    "WRONG_PURPOSE_LOCAL",
    "GENERIC_RECRUITING_OR_BUSINESS_LOCAL",
    "personalDataHarvest: false",
  ]);
  assert.ok(!text.includes("safePublicUrl("));
  assert.ok(!text.includes("publicQueries("));
});
