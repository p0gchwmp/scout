import assert from "node:assert/strict";
import test from "node:test";
import { SEARCH_DISCOVERY_QUERIES } from "../agent/search-discovery.ts";

test("fixed search discovery covers major internship surfaces without caller-supplied queries", () => {
  const joined = SEARCH_DISCOVERY_QUERIES.map((item) => item.query).join("\n");
  for (const expected of [
    "linkedin.com/jobs/view",
    "glassdoor.co.in",
    "internshala.com",
    "wellfound.com",
    "unstop.com",
    "myworkdayjobs.com",
    "myworkdaysite.com",
    "bamboohr.com/jobs",
    "jobs.ashbyhq.com",
    "apply.workable.com",
    "jobs.smartrecruiters.com",
    "tally.so",
    "typeform.com",
    "fillout.com",
    "forms.gle",
  ]) assert.ok(joined.includes(expected), `missing fixed discovery surface: ${expected}`);

  assert.ok(SEARCH_DISCOVERY_QUERIES.length >= 8);
  for (const item of SEARCH_DISCOVERY_QUERIES) {
    assert.ok(item.query.length <= 400, `${item.id} query exceeds provider character limit`);
    assert.ok(item.query.split(/\s+/).filter(Boolean).length <= 50, `${item.id} query exceeds provider word limit`);
  }
});

test("search discovery uses bounded server-owned query ids", () => {
  const ids = SEARCH_DISCOVERY_QUERIES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    "linkedin",
    "glassdoor",
    "internship_boards",
    "workday_bamboo",
    "modern_ats",
    "ats_long_tail",
    "forms",
    "company_careers",
  ]);
});
