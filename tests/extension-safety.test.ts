import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Safe Fill covers major internship portals and form providers without all-URLs access", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8")) as { version?: string; host_permissions?: string[]; permissions?: string[] };
  const hosts = manifest.host_permissions ?? [];
  assert.equal(manifest.version, "0.5.0");
  for (const expected of [
    "https://job-boards.greenhouse.io/*",
    "https://*.myworkdayjobs.com/*",
    "https://*.bamboohr.com/*",
    "https://www.linkedin.com/jobs/*",
    "https://internshala.com/*",
    "https://tally.so/*",
    "https://docs.google.com/forms/*",
    "https://*.typeform.com/*",
    "https://*.fillout.com/*",
  ]) assert.ok(hosts.includes(expected), expected);
  assert.ok(manifest.permissions?.includes("activeTab"));
  assert.ok(manifest.permissions?.includes("scripting"));
  assert.ok(!hosts.includes("<all_urls>"));
});

test("Safe Fill classifies visible controls without sending their entered values", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const popup = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  assert.match(content, /safe_autofill/);
  assert.match(content, /draft_from_claims/);
  assert.match(content, /needs_user_answer/);
  assert.match(content, /sensitive_manual/);
  assert.match(content, /unsupported_manual/);
  assert.match(content, /visibleFields\(\).*slice\(0, 40\)/s);
  assert.match(popup, /fieldMetadata\(inspection\)/);
  assert.match(popup, /body: JSON\.stringify\(\{ token, currentUrl: tab\.url, fields: fieldMetadata\(inspection\) \}\)/);
  assert.doesNotMatch(popup, /field\.value|input\.value|inspection.*value/i);
});

test("Safe Fill requires explicit answer review before any AI text can be inserted", async () => {
  const [content, popup, html] = await Promise.all([
    readFile(new URL("../extension/content.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/popup.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/popup.html", import.meta.url), "utf8"),
  ]);
  assert.match(content, /item\.aiDraft === true && item\.reviewed === true/);
  assert.match(content, /answer\.aiDraft !== true \|\| answer\.reviewed !== true/);
  assert.match(content, /unreviewedAiDraftsFillable: false/);
  assert.match(popup, /Approve for fill/);
  assert.match(popup, /reviewed: true/);
  assert.match(popup, /pendingAnswerReview/);
  assert.match(popup, /revokeDraftApproval/);
  assert.match(popup, /textarea\.disabled = draft\.decision === "approved"/);
  assert.match(html, /Application answer review/);
  assert.match(html, /Unreviewed drafts can never be inserted into the form/);
});

test("Safe Fill requires a pinned approved task, stops on sensitive fields and never submits", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  assert.match(content, /task\.allowedDomain !== location\.hostname/);
  assert.match(content, /expected\.origin !== location\.origin \|\| expected\.pathname !== location\.pathname/);
  assert.match(content, /CAPTCHA detected/);
  assert.match(content, /authorization\|authorisation/);
  assert.match(content, /salary\|compensation/);
  assert.match(content, /linkedin_easy_apply/);
  assert.match(content, /jobs-easy-apply-modal/);
  assert.match(content, /tally_custom_domain/);
  assert.match(content, /submitAvailable: false/);
  assert.match(content, /key === normalizedLabel/);
  assert.doesNotMatch(content, /label\.includes\(key\)|name\.includes\(key\)/);
  assert.doesNotMatch(content, /\.click\(\)|requestSubmit\(|\.submit\(\)/);
});

test("Safe Fill never auto-selects radio, checkbox or file controls", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  assert.match(content, /input\.type === "checkbox" \|\| input\.type === "radio" \|\| input\.type === "file"/);
  assert.match(content, /Manual file step/);
  assert.match(content, /Needs your answer/);
});

test("Safe Fill uses activeTab injection for custom-domain forms instead of broad host access", async () => {
  const popup = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  assert.match(popup, /chrome\.scripting\.executeScript/);
  assert.match(popup, /files: \["content\.js"\]/);
  assert.match(popup, /Review the whole form and submit manually/);
});
