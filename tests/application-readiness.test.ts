import assert from "node:assert/strict";
import test from "node:test";
import { assessApplicationReadiness } from "../lib/scout/application-readiness.ts";
import { REQUIRED_APPLICATION_PROFILE_KEYS } from "../lib/scout/application-prep.ts";

const job = {
  id: "job-1",
  company: "Example",
  title: "Product Operations Intern",
  description: "Part-time internship with flexible hours. Support product workflows, research and documentation.",
  location: "Remote",
  workplaceType: "remote",
  canonicalUrl: "https://job-boards.greenhouse.io/example/jobs/123",
  currentSnapshotId: "snapshot-1",
};

const claims = [{
  id: "claim-product",
  statement: "Mapped clinic workflows and product requirements for a working operations prototype.",
  evidence: "Approved resume evidence",
  status: "approved" as const,
}];

function verifiedProfile() {
  return REQUIRED_APPLICATION_PROFILE_KEYS.map((kind) => ({
    id: `profile-${kind}`,
    kind,
    claim: kind === "resume_reference" ? "approved-resume.pdf" : `verified ${kind}`,
    evidence: "Verified by Ryan",
    verified: true,
  }));
}

test("readiness becomes ready only with official evidence, required profile fields and approved role claims", () => {
  const result = assessApplicationReadiness({ job, profileFields: verifiedProfile(), claims });
  assert.equal(result.status, "ready");
  assert.equal(result.preparationStatus, "ready_for_review");
  assert.equal(result.availability?.lane, "compatible_now");
  assert.equal(result.missingRequiredKeys.length, 0);
  assert.ok(result.claimIds.includes("claim-product"));
  assert.equal(result.score, 100);
  assert.ok(result.manualConfirmations.includes("Work authorization"));
  assert.ok(result.manualConfirmations.includes("Graduation year / degree path"));
});

test("conditional graduation year does not block readiness and is never a Safe Fill field", () => {
  const profile = [...verifiedProfile(), {
    id: "profile-graduation_year",
    kind: "graduation_year",
    claim: "2028 (B.S. exit) / 2029 (B.S. Honours with Research)",
    evidence: "Owner supplied conditional degree path",
    verified: true,
  }];
  const result = assessApplicationReadiness({ job, profileFields: profile, claims });
  assert.equal(result.status, "ready");
  assert.ok(result.optionalVerifiedKeys.includes("graduation_year"));
  assert.ok(result.manualConfirmations.includes("Graduation year / degree path"));
  assert.equal(result.missingRequiredKeys.includes("graduation_year" as never), false);
});

test("missing verified profile evidence is visible and keeps Safe Fill locked", () => {
  const profile = verifiedProfile().filter((field) => field.kind !== "resume_reference");
  const result = assessApplicationReadiness({ job, profileFields: profile, claims });
  assert.equal(result.status, "almost_ready");
  assert.equal(result.preparationStatus, "needs_input");
  assert.deepEqual(result.missingRequiredKeys, ["resume_reference"]);
  assert.match(result.profileSummary, /^5\/6 required/);
});

test("draft or rejected claims cannot make an application ready", () => {
  const result = assessApplicationReadiness({
    job,
    profileFields: verifiedProfile(),
    claims: claims.map((claim) => ({ ...claim, status: "draft" as const })),
  });
  assert.equal(result.status, "almost_ready");
  assert.equal(result.claimIds.length, 0);
  assert.ok(result.blockers.some((blocker) => blocker.includes("No approved resume claims")));
});

test("approved but unrelated claims do not satisfy role-specific readiness", () => {
  const result = assessApplicationReadiness({
    job,
    profileFields: verifiedProfile(),
    claims: [{ id: "claim-unrelated", statement: "Completed introductory macroeconomics coursework.", evidence: "Verified course record", status: "approved" }],
  });
  assert.equal(result.status, "almost_ready");
  assert.equal(result.preparationStatus, "needs_input");
  assert.deepEqual(result.claimIds, []);
  assert.ok(result.blockers.some((blocker) => blocker.includes("role-specific answers")));
});

test("missing official snapshot is a critical blocker even with a complete profile", () => {
  const result = assessApplicationReadiness({ job: { ...job, currentSnapshotId: null }, profileFields: verifiedProfile(), claims });
  assert.equal(result.status, "blocked");
  assert.ok(result.score <= 49);
  assert.ok(result.criticalBlockers.some((blocker) => blocker.includes("immutable job snapshot")));
});
