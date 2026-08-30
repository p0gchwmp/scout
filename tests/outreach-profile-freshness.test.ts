import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTREACH_PROFILE_FRESHNESS_CAPABILITIES,
  currentVerifiedOutreachIdentity,
  outreachIdentityExecutionIssues,
  verifiedOutreachCandidateName,
} from "../lib/scout/outreach-profile-freshness.ts";

const baseFields = [{
  id: "profile_name",
  kind: "full_name",
  claim: "Ryan Vivek Mahajan",
  verified: true,
  updatedAt: "2026-08-29T10:00:00.000Z",
}];

test("outreach identity must come from exactly one current verified full_name field", () => {
  assert.equal(currentVerifiedOutreachIdentity(baseFields)?.fullName, "Ryan Vivek Mahajan");
  assert.equal(currentVerifiedOutreachIdentity([{ ...baseFields[0], verified: false }]), null);
  assert.equal(currentVerifiedOutreachIdentity([...baseFields, { ...baseFields[0], id: "duplicate" }]), null);
  assert.equal(currentVerifiedOutreachIdentity([{ ...baseFields[0], updatedAt: "invalid" }]), null);
});

test("caller-supplied candidate name cannot override verified profile identity", () => {
  assert.equal(verifiedOutreachCandidateName(baseFields), "Ryan Vivek Mahajan");
  assert.equal(verifiedOutreachCandidateName(baseFields, "  Ryan   Vivek Mahajan  "), "Ryan Vivek Mahajan");
  assert.throws(
    () => verifiedOutreachCandidateName(baseFields, "Ryan Mahajan"),
    /must match the current verified full_name/i,
  );
});

test("approved outreach becomes stale when full_name was touched after the revision was created", () => {
  assert.deepEqual(outreachIdentityExecutionIssues({
    revisionCreatedAt: "2026-08-29T11:00:00.000Z",
    currentProfileFields: baseFields,
  }), []);
  assert.match(outreachIdentityExecutionIssues({
    revisionCreatedAt: "2026-08-29T09:00:00.000Z",
    currentProfileFields: baseFields,
  }).join(" "), /changed after/i);
  assert.match(outreachIdentityExecutionIssues({
    revisionCreatedAt: "2026-08-29T11:00:00.000Z",
    currentProfileFields: [{ ...baseFields[0], verified: false }],
  }).join(" "), /missing or ambiguous/i);
});

test("M12 adds identity freshness without new execution capability", () => {
  assert.equal(OUTREACH_PROFILE_FRESHNESS_CAPABILITIES.requireVerifiedFullName, true);
  assert.equal(OUTREACH_PROFILE_FRESHNESS_CAPABILITIES.rejectCallerIdentityOverride, true);
  assert.equal(OUTREACH_PROFILE_FRESHNESS_CAPABILITIES.recheckIdentityBeforeGmailDraft, true);
  assert.equal(OUTREACH_PROFILE_FRESHNESS_CAPABILITIES.staleOnUnverifyEditOrReverify, true);
  assert.equal(OUTREACH_PROFILE_FRESHNESS_CAPABILITIES.inferIdentity, false);
  assert.equal(OUTREACH_PROFILE_FRESHNESS_CAPABILITIES.sendEmail, false);
  assert.equal(OUTREACH_PROFILE_FRESHNESS_CAPABILITIES.submitApplication, false);
});
