import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PREFERENCE_CALIBRATION_CAPABILITIES } from "../lib/scout/preference-calibration.ts";

test("preference workspace is owner-only, browser-local and inspectable", async () => {
  const [page, client, root, worker] = await Promise.all([
    readFile(new URL("../app/preferences/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preferences/preference-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /requireChatGPTUser\("\/preferences"\)/);
  assert.match(page, /requireScoutPageOwner\(/);
  assert.match(worker, /OWNER_PAGE_PATHS\.add\("\/preferences"\)/);
  assert.ok(root.includes('["Preferences", "/preferences"]'));
  assert.match(client, /window\.localStorage/);
  assert.match(client, /PREFERENCE_STORAGE_KEY/);
  assert.match(client, /fetch\("\/api\/jobs"\)/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
});

test("shortlist feedback uses explicit decisions only and Save clears the local taste signal", async () => {
  const shortlist = await readFile(new URL("../app/shortlist/shortlist-client.tsx", import.meta.url), "utf8");
  assert.match(shortlist, /state === "shortlisted" \? "interested"/);
  assert.match(shortlist, /state === "rejected" \? "not_interested"/);
  assert.match(shortlist, /: null;/);
  assert.match(shortlist, /Save \/ neutral/);
  assert.match(shortlist, /Saved\/discovered roles are neutral/);
  assert.doesNotMatch(shortlist, /click|viewed|opened.{0,40}preference/i);
});

test("calibration remains a soft recommendation layer rather than a hidden eligibility rule", () => {
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.explicitFeedbackOnly, true);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.savedStateIsNeutral, true);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.singleRejectionCanBlockFamily, false);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.hardEligibilityUnaffected, true);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.approvedEvidenceUnaffected, true);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.geographyLearning, false);
  assert.equal(PREFERENCE_CALIBRATION_CAPABILITIES.automaticRoleHiding, false);
  assert.ok(PREFERENCE_CALIBRATION_CAPABILITIES.maximumAbsoluteNudge <= 6);
});
