import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES } from "../lib/scout/opportunity-quality-intelligence.ts";

test("opportunity quality workspace is owner-only and read-only", async () => {
  const [page, client, root, worker] = await Promise.all([
    readFile(new URL("../app/quality/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/quality/quality-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /requireChatGPTUser\("\/quality"\)/);
  assert.match(page, /requireScoutPageOwner\(/);
  assert.match(worker, /OWNER_PAGE_PATHS\.add\("\/quality"\)/);
  assert.ok(root.includes('["Quality", "/quality"]'));
  assert.match(client, /fetch\("\/api\/jobs"\)/);
  assert.match(client, /fetch\("\/api\/sources"\)/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
});

test("quality intelligence never certifies legitimacy, invents pay, or mutates fit", async () => {
  const client = await readFile(new URL("../app/quality/quality-client.tsx", import.meta.url), "utf8");
  assert.match(client, /without certifying a company as legitimate/i);
  assert.match(client, /Compensation not published/);
  assert.match(client, /No role is auto-rejected/);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.persistedEvidenceOnly, true);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.inferMissingCompensation, false);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.inferCompanyLegitimacy, false);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.autoRejectOpportunity, false);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.modifyResumeFitScore, false);
  assert.equal(OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES.geographyBias, false);
});
