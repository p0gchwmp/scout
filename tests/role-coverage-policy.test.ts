import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("search discovery keeps the existing query count while broadening India and global role coverage", async () => {
  const source = await readFile(new URL("../agent/search-discovery.ts", import.meta.url), "utf8");
  const ids = [...source.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 12, "role coverage milestone must not increase external search-query count");
  for (const term of ["analyst", "product", "operations", "strategy", "finance", "research", "implementation", "solutions", "QA", "technical operations"]) {
    assert.match(source, new RegExp(term, "i"), `search lanes should include ${term}`);
  }
  assert.match(source, /id: "linkedin_global"/);
  assert.match(source, /id: "linkedin_india"/);
  assert.match(source, /id: "india_policy_public"/);
  assert.match(source, /id: "modern_ats_global"/);
  assert.match(source, /id: "modern_ats_india"/);
});

test("shortlist exposes role-family filtering and does not hide the software-development lane", async () => {
  const client = await readFile(new URL("../app/shortlist/shortlist-client.tsx", import.meta.url), "utf8");
  assert.match(client, /Filter by role family/);
  assert.match(client, /ROLE_FAMILIES\.map/);
  assert.match(client, /assessment\.roleFamilyLabel/);
  assert.match(client, /assessment\.preferenceLabel/);
  assert.match(client, /assessment\.sectorTags/);
  assert.match(client, /Pure software development stays visible as a stretch preference rather than being hidden/);
  assert.doesNotMatch(client, /roleFamilyId\s*!==\s*"software_development"/);
});
