import assert from "node:assert/strict";
import test from "node:test";
import { SEARCH_DISCOVERY_QUERIES } from "../agent/search-discovery.ts";

test("fixed search discovery covers major internship surfaces without caller-supplied queries", () => {
  const joined = SEARCH_DISCOVERY_QUERIES.map((item) => item.query).join("\n");
  for (const expected of [
    "linkedin.com/jobs/view",
    "glassdoor.com",
    "internshala.com",
    "wellfound.com",
    "unstop.com",
    "myworkdayjobs.com",
    "myworkdaysite.com",
    "bamboohr.com/jobs",
    "jobs.ashbyhq.com",
    "apply.workable.com",
    "jobs.smartrecruiters.com",
    "teamtailor.com",
    "recruitee.com",
    "breezy.hr",
    "tally.so",
    "typeform.com",
    "fillout.com",
    "forms.gle",
  ]) assert.ok(joined.includes(expected), `missing fixed discovery surface: ${expected}`);

  assert.equal(SEARCH_DISCOVERY_QUERIES.length, 14);
  for (const item of SEARCH_DISCOVERY_QUERIES) {
    assert.ok(item.query.length <= 400, `${item.id} query exceeds provider character limit`);
    assert.ok(item.query.split(/\s+/).filter(Boolean).length <= 50, `${item.id} query exceeds provider word limit`);
  }
});

test("search discovery uses bounded server-owned query ids with explicit current-remote and Summer 2027 lanes", () => {
  const ids = SEARCH_DISCOVERY_QUERIES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    "linkedin_global",
    "linkedin_india",
    "india_job_boards",
    "global_startup_boards",
    "now_remote_student",
    "summer_2027",
    "india_policy_public",
    "workday_bamboo_global",
    "modern_ats_global",
    "modern_ats_india",
    "ats_long_tail",
    "forms",
    "company_careers_global",
    "company_careers_india",
  ]);
  const currentRemote = SEARCH_DISCOVERY_QUERIES.find((item) => item.id === "now_remote_student");
  const summer = SEARCH_DISCOVERY_QUERIES.find((item) => item.id === "summer_2027");
  assert.match(currentRemote?.query ?? "", /remote internship student/i);
  assert.match(summer?.query ?? "", /Summer 2027 internship/i);
});
