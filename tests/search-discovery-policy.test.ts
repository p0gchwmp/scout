import assert from "node:assert/strict";
import test from "node:test";
import { SEARCH_DISCOVERY_QUERIES } from "../agent/search-discovery.ts";

test("search discovery keeps both worldwide and India-specific lanes", () => {
  const byId = new Map(SEARCH_DISCOVERY_QUERIES.map((query) => [query.id, query]));

  for (const id of ["linkedin_global", "modern_ats_global", "company_careers_global"]) {
    assert.ok(byId.has(id), `${id} should keep worldwide discovery open`);
  }
  for (const id of ["linkedin_india", "india_job_boards", "india_policy_public", "modern_ats_india", "company_careers_india"]) {
    assert.ok(byId.has(id), `${id} should preserve deliberate India coverage`);
  }

  assert.match(byId.get("india_job_boards")?.query ?? "", /internshala\.com/);
  assert.match(byId.get("india_job_boards")?.query ?? "", /unstop\.com/);
  assert.match(byId.get("india_job_boards")?.query ?? "", /naukri\.com/);
  assert.match(byId.get("india_policy_public")?.query ?? "", /prsindia\.org/);
  assert.match(byId.get("india_policy_public")?.query ?? "", /niti\.gov\.in/);
  assert.ok(SEARCH_DISCOVERY_QUERIES.some((query) => !/\bIndia\b/i.test(query.query)), "not every search query should be India-restricted");
});
