import assert from "node:assert/strict";
import test from "node:test";
import { isLikelySpecificJobTitle } from "../lib/scout/job-quality.ts";
import { evaluateResumeAlignment } from "../lib/scout/resume-alignment.ts";

const approvedClaims = [
  {
    id: "claim-product",
    statement: "Translated clinic operations into product requirements and workflow rules.",
    evidence: "Approved product and operations evidence.",
    status: "approved" as const,
  },
];

test("generic careers and ATS landing pages are not treated as specific jobs", () => {
  const landingPages = [
    "page_title",
    "Search for Jobs - Myworkdayjobs.com",
    "Carrier Careers",
    "Careers - CrowdStrike",
    "Jobs at SmithRx",
    "Explore career opportunities at Pinterest | Pinterest Careers",
    "Explore Our Open Positions - CoreWeave",
    "Join our global team | Upsun",
    "Open Positions | Teneo",
    "Opportunities at PRS",
    "Drivetrain - Lever",
  ];
  for (const title of landingPages) assert.equal(isLikelySpecificJobTitle(title), false, title);
});

test("specific internship and analyst titles remain visible", () => {
  const roles = [
    "Product Management Intern- Insurance",
    "GTM Strategy & Operations Intern",
    "Public Finance and Policy Analysis",
    "Apprentice (R-19888)",
    "Business Development Associate Intern",
  ];
  for (const title of roles) assert.equal(isLikelySpecificJobTitle(title), true, title);
});

test("approved claims with zero relevant overlap are not reported as unconfigured", () => {
  const alignment = evaluateResumeAlignment({
    title: "Talent Acquisition Intern",
    description: "Source candidates and coordinate recruiting interviews.",
    location: "Bengaluru, India",
  }, approvedClaims);

  assert.equal(alignment.supportingClaims.length, 0);
  assert.deepEqual(alignment.eligibilityGaps, ["No relevant approved claim overlap found for this posting"]);
  assert.match(alignment.basis, /approved resume claim/);
});
