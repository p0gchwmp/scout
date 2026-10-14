import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { planVerifiedDesktopFill, safeSourceForDesktopField, DESKTOP_FILL_CAPABILITIES } from "../lib/scout/desktop-fill-policy.mjs";

const base = {
  index: 0, label: "Email *", name: "candidate_email", domId: "", autocomplete: "email",
  inputType: "email", controlKind: "input", visible: true, disabled: false, readOnly: false,
  fingerprint: "email-field",
};

test("desktop Safe Fill uses only a verified matching profile source", () => {
  assert.equal(safeSourceForDesktopField(base), "email");
  assert.deepEqual(planVerifiedDesktopFill([base], [
    { sourceField: "email", key: "email", value: "verified@example.com", verified: true },
    { sourceField: "phone", key: "phone", value: "invented", verified: false },
  ]), [{ index: 0, sourceField: "email", value: "verified@example.com", fingerprint: "email-field" }]);
  assert.deepEqual(planVerifiedDesktopFill([base], [{ sourceField: "email", value: "unverified@example.com", verified: false }]), []);
});

test("desktop Safe Fill supports common name/email/tel attributes but not ambiguous fields", () => {
  assert.equal(safeSourceForDesktopField({ ...base, label: "", name: "applicant_email", autocomplete: "", inputType: "text" }), "email");
  assert.equal(safeSourceForDesktopField({ ...base, label: "Field", name: "", autocomplete: "tel", inputType: "tel" }), "phone");
  assert.equal(safeSourceForDesktopField({ ...base, label: "Name", name: "candidate_name", autocomplete: "name", inputType: "text" }), "full_name");
  assert.equal(safeSourceForDesktopField({ ...base, label: "First name", name: "name", autocomplete: "name", inputType: "text" }), null);
  assert.equal(safeSourceForDesktopField({ ...base, label: "Emergency phone", name: "phone", autocomplete: "tel", inputType: "tel" }), null);
  assert.equal(safeSourceForDesktopField({ ...base, label: "Work authorization", name: "email", autocomplete: "email" }), null);
  assert.equal(safeSourceForDesktopField({ ...base, label: "Referral email", name: "email", autocomplete: "email" }), null);
  assert.equal(safeSourceForDesktopField({ ...base, label: "Email", name: "email", inputType: "file" }), null);
  assert.equal(safeSourceForDesktopField({ ...base, label: "Email", name: "email", inputType: "radio" }), null);
});

test("desktop Safe Fill is bounded and does not reuse unsupported or conflicting data", () => {
  assert.throws(() => planVerifiedDesktopFill(Array.from({ length: 41 }, () => base), []), /Bounded/);
  assert.throws(() => planVerifiedDesktopFill([base], [
    { sourceField: "email", value: "one@example.com", verified: true },
    { sourceField: "email", value: "two@example.com", verified: true },
  ]), /Conflicting/);
  assert.equal(DESKTOP_FILL_CAPABILITIES.submitApplications, false);
  assert.equal(DESKTOP_FILL_CAPABILITIES.modifySensitiveFields, false);
  assert.equal(DESKTOP_FILL_CAPABILITIES.uploadFiles, false);
});

test("desktop runner validates signed task, opens an isolated Edge profile and never submits", async () => {
  const runner = await readFile(new URL("../scripts/scout-desktop-fill.mjs", import.meta.url), "utf8");
  const assist = await readFile(new URL("../app/assist/assist-client.tsx", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["scout:fill"], "node scripts/scout-desktop-fill.mjs");
  assert.match(runner, /SCOUT_ORIGIN = "https:\/\/ryan-scout-e3a2eb4fdd1a\.herokuapp\.com"/);
  assert.match(runner, /\/browser-handoff\/exchange/);
  assert.match(runner, /task\.allowedUrl !== candidate\.allowedUrl/);
  assert.match(runner, /scout-desktop-fill-/);
  assert.match(runner, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(runner, /submitted: false/);
  assert.match(runner, /if \(String\(input\.value \|\| ""\)\.trim\(\)\)/);
  assert.match(runner, /Type FILL/);
  assert.doesNotMatch(runner, /requestSubmit\(|\.submit\(|\.click\(\)/);
  assert.match(assist, /npm run scout:fill/);
});
