import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("role cockpit is owner-only, reachable and read-only", async () => {
  const [indexPage, detailPage, indexClient, detailClient, root, worker] = await Promise.all([
    readFile(new URL("../app/roles/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roles/[jobId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roles/role-index-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roles/[jobId]/role-cockpit-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(indexPage, /requireChatGPTUser\("\/roles"\)/);
  assert.match(detailPage, /requireChatGPTUser\(`\/roles\/\$\{jobId\}`\)/);
  assert.match(indexPage, /requireScoutPageOwner\(/);
  assert.match(detailPage, /requireScoutPageOwner\(/);
  assert.ok(root.includes('["Roles", "/roles"]'));
  assert.match(worker, /OWNER_PAGE_PATHS\.add\("\/roles"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/roles\/"\)/);

  assert.doesNotMatch(indexClient, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
  assert.doesNotMatch(detailClient, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
});

test("role cockpit keeps fit, quality, preference and readiness as separate visible axes", async () => {
  const client = await readFile(new URL("../app/roles/[jobId]/role-cockpit-client.tsx", import.meta.url), "utf8");
  for (const label of ["FIT", "OPPORTUNITY QUALITY", "PREFERENCE", "APPLICATION READINESS"]) assert.ok(client.includes(label));
  assert.match(client, /buildRoleDecisionSummary/);
  assert.match(client, /No application submission or email send capability is enabled here/);
  assert.doesNotMatch(client, /overallScore|compositeScore|averageScore/);
});
