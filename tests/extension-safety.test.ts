import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Safe Fill covers major internship portals and form providers without all-URLs access", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8")) as { host_permissions?: string[]; permissions?: string[] };
  const hosts = manifest.host_permissions ?? [];
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
  assert.doesNotMatch(content, /\.click\(\)|requestSubmit\(|\.submit\(\)/);
});

test("Safe Fill uses activeTab injection for custom-domain forms instead of broad host access", async () => {
  const popup = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  assert.match(popup, /chrome\.scripting\.executeScript/);
  assert.match(popup, /files: \["content\.js"\]/);
  assert.match(popup, /Review the whole form and submit manually/);
});
