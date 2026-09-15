import assert from "node:assert/strict";
import test from "node:test";
import {
  ALWAYS_CONFIRM_APPLICATION_FIELDS,
  buildApplicationPreparation,
  REQUIRED_APPLICATION_PROFILE_KEYS,
  type ApplicationProfileField,
} from "../lib/scout/application-prep.ts";

const claims = [{
  id: "claim-product-ops",
  statement: "Mapped workflows and product requirements for an operations prototype.",
  evidence: "Approved resume evidence",
  status: "approved" as const,
}];

function requiredProfile(): ApplicationProfileField[] {
  return REQUIRED_APPLICATION_PROFILE_KEYS.map((kind, index) => ({
    id: `profile-${kind}`,
    kind,
    claim: kind === "resume_reference" ? "approved-resume.pdf" : `verified ${kind}`,
    evidence: "Verified by Ryan",
    verified: true,
    updatedAt: `2026-09-15T00:0${index}:00.000Z`,
  }));
}

const baseJob = {
  id: "job-friction",
  company: "Example",
  title: "Product Operations Intern",
  canonicalUrl: "https://job-boards.greenhouse.io/example/jobs/123",
  currentSnapshotId: "snapshot-friction",
};

test("current location is optional for baseline preparation and is never inferred", () => {
  assert.equal(REQUIRED_APPLICATION_PROFILE_KEYS.includes("current_location"), false);

  const prepared = buildApplicationPreparation({
    job: {
      ...baseJob,
      description: "Support product workflows, research and documentation.",
      location: "Remote",
      workplaceType: "remote",
    },
    profileFields: requiredProfile(),
    claims,
    relevantClaimIds: ["claim-product-ops"],
    now: new Date("2026-09-15T00:00:00.000Z"),
  });

  assert.equal(prepared.status, "ready_for_review");
  assert.equal(prepared.packet.availability?.lane, "needs_verification");
  assert.equal(prepared.packet.availabilityReviewRequired, true);
  assert.equal(prepared.packet.safeFields.current_location, undefined);
  assert.equal(prepared.packet.missingProfileKeys.includes("current_location"), false);
  assert.equal(prepared.blockers.some((blocker) => /current_location|availability must be verified/i.test(blocker)), false);
  assert.ok(ALWAYS_CONFIRM_APPLICATION_FIELDS.includes("availability"));
});

test("verified current location remains reusable and provenance-pinned when supplied", () => {
  const prepared = buildApplicationPreparation({
    job: {
      ...baseJob,
      description: "Part-time internship with flexible hours supporting product operations.",
      location: "Remote",
      workplaceType: "remote",
    },
    profileFields: [
      ...requiredProfile(),
      {
        id: "profile-current-location",
        kind: "current_location",
        claim: "Jammu, India",
        evidence: "Verified by Ryan",
        verified: true,
        updatedAt: "2026-09-15T00:10:00.000Z",
      },
    ],
    claims,
    relevantClaimIds: ["claim-product-ops"],
    now: new Date("2026-09-15T00:00:00.000Z"),
  });

  assert.equal(prepared.packet.safeFields.current_location, "Jammu, India");
  assert.ok(prepared.packet.profileBindings.some((binding) => binding.kind === "current_location"));
});

test("explicit semester availability mismatches still block preparation", () => {
  const prepared = buildApplicationPreparation({
    job: {
      ...baseJob,
      description: "Six-month full-time internship, Monday-Friday, in office.",
      location: "Bengaluru, India",
      workplaceType: "on-site",
    },
    profileFields: requiredProfile(),
    claims,
    relevantClaimIds: ["claim-product-ops"],
    now: new Date("2026-09-15T00:00:00.000Z"),
  });

  assert.equal(prepared.status, "needs_input");
  assert.equal(prepared.packet.availability?.lane, "hard_mismatch");
  assert.ok(prepared.blockers.some((blocker) => blocker.startsWith("Availability mismatch:")));
});
