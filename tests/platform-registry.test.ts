import assert from "node:assert/strict";
import test from "node:test";
import { classifyApplicationUrl } from "../lib/scout/application-sites.ts";
import { PLATFORM_ROADMAP, SCOUT_PLATFORM_POLICIES, classifyPlatformUrl } from "../lib/scout/platform-registry.ts";

test("platform registry recognizes broad internship application ecosystem", () => {
  const cases = [
    ["https://www.linkedin.com/jobs/view/123", "linkedin"],
    ["https://internshala.com/internship/detail/test", "internshala"],
    ["https://www.glassdoor.co.in/job-listing/test", "glassdoor"],
    ["https://company.wd5.myworkdayjobs.com/en-US/careers/job/123", "workday"],
    ["https://acme.bamboohr.com/careers/123", "bamboohr"],
    ["https://careers.icims.com/jobs/123", "icims"],
    ["https://jobs.jobvite.com/acme/job/abc", "jobvite"],
    ["https://acme.recruitee.com/o/intern", "recruitee"],
    ["https://jobs.teamtailor.com/jobs/123", "teamtailor"],
    ["https://acme.breezy.hr/p/abc-intern", "breezyhr"],
    ["https://acme.applytojob.com/apply/abc", "jazzhr"],
    ["https://jobs.personio.com/acme/job/123", "personio"],
    ["https://ats.rippling.com/acme/jobs/123", "rippling"],
    ["https://jobs.freshteam.com/acme/jobs/123", "freshteam"],
    ["https://acme.zohorecruit.com/jobs/Careers/123", "zohorecruit"],
    ["https://company.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123", "oracle"],
    ["https://career5.successfactors.eu/career?company=acme", "successfactors"],
    ["https://acme.taleo.net/careersection/jobdetail.ftl?job=123", "taleo"],
    ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html", "adp"],
    ["https://acme.eightfold.ai/careers/job/123", "eightfold"],
    ["https://jobs.phenompeople.com/job/123", "phenom"],
    ["https://acme.avature.net/careers/JobDetail/123", "avature"],
    ["https://tally.so/r/abc123", "tally"],
    ["https://docs.google.com/forms/d/e/abc/viewform", "google_forms"],
    ["https://forms.gle/abc123", "google_forms"],
    ["https://acme.typeform.com/to/abc123", "typeform"],
    ["https://form.fillout.com/t/abc123", "fillout"],
    ["https://form.jotform.com/123456", "jotform"],
    ["https://forms.office.com/r/abc123", "microsoft_forms"],
    ["https://www.cutshort.io/job/product-intern-abc", "cutshort"],
    ["https://www.foundit.in/job/product-intern-123", "foundit"],
  ] as const;
  for (const [url, id] of cases) assert.equal(classifyPlatformUrl(url).id, id, url);
});

test("LinkedIn search and Easy Apply remain reviewed lead/browser-assist flows", () => {
  const linkedIn = classifyPlatformUrl("https://www.linkedin.com/jobs/search/?keywords=product%20intern");
  assert.equal(linkedIn.discovery, "user_session");
  assert.equal(linkedIn.application, "reviewed_easy_apply");
  assert.equal(linkedIn.easyApplyAssist, true);
  assert.equal(linkedIn.requiresOfficialResolution, true);
  assert.equal(linkedIn.contactResearch, "none");
  assert.equal(linkedIn.finalSubmitRequiresApproval, true);
  assert.match(linkedIn.restrictions.join(" "), /Never mass-automate LinkedIn search or Easy Apply/);
});

test("form application platforms require upstream company and job provenance", () => {
  for (const url of [
    "https://tally.so/r/abc123",
    "https://docs.google.com/forms/d/e/abc/viewform",
    "https://forms.gle/abc123",
    "https://acme.typeform.com/to/abc123",
    "https://form.fillout.com/t/abc123",
    "https://form.jotform.com/123456",
    "https://forms.office.com/r/abc123",
  ]) {
    const platform = classifyPlatformUrl(url);
    assert.equal(platform.kind, "form", url);
    assert.equal(platform.application, "browser_assist", url);
    assert.equal(platform.requiresOfficialResolution, true, url);
    assert.equal(platform.finalSubmitRequiresApproval, true, url);
    assert.match(platform.restrictions.join(" "), /Require upstream official company\/job evidence/);
  }
  assert.match(classifyPlatformUrl("https://tally.so/r/abc123").note, /custom-domain Tally forms/);
});

test("job-board channels block application preparation until official resolution", () => {
  for (const url of [
    "https://www.linkedin.com/jobs/view/1",
    "https://internshala.com/internship/detail/test",
    "https://www.glassdoor.com/job-listing/test",
    "https://www.indeed.com/viewjob?jk=1",
    "https://www.naukri.com/job-listings-test-1",
    "https://wellfound.com/jobs/1",
    "https://unstop.com/internships/test",
    "https://www.cutshort.io/job/test",
    "https://www.foundit.in/job/test",
  ]) {
    assert.equal(classifyApplicationUrl(url).requiresOfficialResolution, true, url);
  }
});

test("platform roadmap covers structured ATS, browser-assist ATS, forms, job boards and enterprise long tail", () => {
  assert.ok(PLATFORM_ROADMAP.structuredFirst.includes("greenhouse"));
  assert.ok(PLATFORM_ROADMAP.structuredFirst.includes("lever"));
  assert.ok(PLATFORM_ROADMAP.browserAssistNext.includes("workday"));
  assert.ok(PLATFORM_ROADMAP.browserAssistNext.includes("bamboohr"));
  assert.ok(PLATFORM_ROADMAP.formApplications.includes("tally"));
  assert.ok(PLATFORM_ROADMAP.formApplications.includes("google_forms"));
  assert.ok(PLATFORM_ROADMAP.jobBoardLeadCoverage.includes("linkedin"));
  assert.ok(PLATFORM_ROADMAP.jobBoardLeadCoverage.includes("internshala"));
  assert.ok(PLATFORM_ROADMAP.jobBoardLeadCoverage.includes("glassdoor"));
  assert.ok(PLATFORM_ROADMAP.enterpriseLongTail.includes("successfactors"));
  assert.ok(SCOUT_PLATFORM_POLICIES.length >= 36);
});
