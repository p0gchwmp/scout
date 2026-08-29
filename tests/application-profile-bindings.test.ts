import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_PROFILE_BINDING_CAPABILITIES,
  applicationPacketProfileBindingIssues,
  applicationPacketProfileBindingsCurrent,
  buildApplicationProfileBindings,
} from "../lib/scout/application-profile-bindings.ts";

const fields = [
  { id: "profile_name", kind: "full_name", claim: "Ryan Mahajan", verified: true, updatedAt: "2026-08-29T08:00:00.000Z" },
  { id: "profile_email", kind: "email", claim: "ryan@example.com", verified: true, updatedAt: "2026-08-29T08:01:00.000Z" },
  { id: "profile_grad", kind: "graduation_year", claim: "2028 / 2029 path", verified: true, updatedAt: "2026-08-29T08:02:00.000Z" },
];
const safeFields = { full_name: "Ryan Mahajan", email: "ryan@example.com" };
const packet = {
  schemaVersion: 1,
  safeFields,
  profileBindings: buildApplicationProfileBindings(fields, safeFields),
};

test("application packet pins the exact verified profile evidence rows used by safe fields", () => {
  assert.deepEqual(packet.profileBindings, [
    { id: "profile_email", kind: "email", updatedAt: "2026-08-29T08:01:00.000Z" },
    { id: "profile_name", kind: "full_name", updatedAt: "2026-08-29T08:00:00.000Z" },
  ]);
  assert.equal(packet.profileBindings.some((binding) => binding.kind === "graduation_year"), false);
  assert.equal(applicationPacketProfileBindingsCurrent(packet, fields), true);
});

test("unverifying a previously pinned profile field makes the application packet stale", () => {
  const current = fields.map((field) => field.id === "profile_email" ? { ...field, verified: false, updatedAt: "2026-08-29T09:00:00.000Z" } : field);
  assert.equal(applicationPacketProfileBindingsCurrent(packet, current), false);
  assert.deepEqual(applicationPacketProfileBindingIssues(packet, current), ["Verified profile evidence changed: email"]);
});

test("editing and reverifying the same profile row still requires a fresh application packet", () => {
  const current = fields.map((field) => field.id === "profile_name"
    ? { ...field, claim: "Ryan Vivek Mahajan", updatedAt: "2026-08-29T09:10:00.000Z" }
    : field);
  assert.equal(applicationPacketProfileBindingsCurrent(packet, current), false);
  assert.deepEqual(applicationPacketProfileBindingIssues(packet, current), ["Verified profile evidence changed: full_name"]);
});

test("legacy packets without profile evidence bindings fail closed for browser assistance", () => {
  const legacy = { schemaVersion: 1, safeFields };
  assert.equal(applicationPacketProfileBindingsCurrent(legacy, fields), false);
  assert.deepEqual(applicationPacketProfileBindingIssues(legacy, fields), ["Application packet predates verified profile-evidence pinning"]);
});

test("new unrelated profile evidence does not invalidate values the packet never uses", () => {
  const current = [...fields, { id: "profile_github", kind: "github_url", claim: "https://github.com/example", verified: true, updatedAt: "2026-08-29T09:20:00.000Z" }];
  assert.equal(applicationPacketProfileBindingsCurrent(packet, current), true);
});

test("profile binding capability surface remains non-autonomous", () => {
  assert.equal(APPLICATION_PROFILE_BINDING_CAPABILITIES.pinVerifiedEvidenceRows, true);
  assert.equal(APPLICATION_PROFILE_BINDING_CAPABILITIES.requireCurrentVerificationBeforeBrowserAssist, true);
  assert.equal(APPLICATION_PROFILE_BINDING_CAPABILITIES.allowLegacyUnpinnedBrowserAssist, false);
  assert.equal(APPLICATION_PROFILE_BINDING_CAPABILITIES.inferProfileValues, false);
  assert.equal(APPLICATION_PROFILE_BINDING_CAPABILITIES.submitApplication, false);
});
