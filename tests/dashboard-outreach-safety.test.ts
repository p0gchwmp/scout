import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dashboard outreach requires exact review before Gmail draft creation", async () => {
  const dashboard = await source("app/dashboard.tsx");
  assert.doesNotMatch(dashboard, /gmailComposeUrl/);
  assert.match(dashboard, /method: "PATCH"/);
  assert.match(dashboard, /revisionId: revision\.id, action/);
  assert.match(dashboard, /draft\.state !== "approved" \|\| !draft\.approvedRevisionId/);
  assert.match(dashboard, /\/api\/agent\/create-gmail-draft/);
  assert.match(dashboard, /Nothing was sent/);
});

test("dashboard exposes Gmail draft creation only for the approved exact revision", async () => {
  const dashboard = await source("app/dashboard.tsx");
  assert.match(dashboard, /approvedExactRevision = draft\.state === "approved"/);
  assert.match(dashboard, /displayed\?\.id === draft\.approvedRevisionId/);
  assert.match(dashboard, /approvedExactRevision && <div className="actions">/);
  assert.doesNotMatch(dashboard, /Open in Gmail/);
});
