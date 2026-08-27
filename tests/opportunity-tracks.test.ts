import assert from "node:assert/strict";
import test from "node:test";
import {
  assessOpportunityTrack,
  classifyOpportunityType,
  CULTURE_RELEVANT_BRAND_WATCHLIST,
  matchesOpportunityRegion,
  OPPORTUNITY_TRACK_LABELS,
  SUMMER_2027_WINDOW,
} from "../lib/scout/opportunity-tracks.ts";

const remoteIndia = {
  company: "Sprinto",
  title: "Revenue & Operations Intern",
  location: "Remote (India)",
  focus: "product-led growth, operations, startups",
};

test("remote India belongs to both India and Remote filters", () => {
  assert.equal(matchesOpportunityRegion(remoteIndia, "India"), true);
  assert.equal(matchesOpportunityRegion(remoteIndia, "Remote"), true);
  assert.equal(matchesOpportunityRegion(remoteIndia, "Global"), false);
});

test("remote internships default into the alongside-college lane without inventing schedule fit", () => {
  const assessment = assessOpportunityTrack(remoteIndia);
  assert.equal(assessment.opportunityType, "internship");
  assert.equal(assessment.track, "now_remote");
  assert.equal(assessment.collegeCompatibility, "unknown");
  assert.match(assessment.collegeCompatibilityReason, /confirm hours\/days/i);
});

test("explicit heavy remote schedule is surfaced as a likely college conflict", () => {
  const assessment = assessOpportunityTrack({
    ...remoteIndia,
    description: "Remote internship. Must be available at least 6 hours per day Monday-Friday.",
  });
  assert.equal(assessment.collegeCompatibility, "likely_conflict");
});

test("part-time flexible remote signal is promising but still review-bound", () => {
  const assessment = assessOpportunityTrack({
    ...remoteIndia,
    description: "Part-time with flexible hours alongside studies.",
  });
  assert.equal(assessment.collegeCompatibility, "promising");
  assert.match(assessment.collegeCompatibilityReason, /still confirm/i);
});

test("Summer 2027 is an explicit track with the approved corporate window", () => {
  assert.equal(SUMMER_2027_WINDOW.start, "2027-05-21");
  assert.equal(SUMMER_2027_WINDOW.end, "2027-07-31");
  assert.equal(OPPORTUNITY_TRACK_LABELS.summer_2027, "Summer 2027");
  const assessment = assessOpportunityTrack({
    company: "Example",
    title: "Product Intern - Summer 2027",
    location: "Bengaluru, India",
    description: "10 week internship",
  });
  assert.equal(assessment.track, "summer_2027");
  assert.equal(assessment.summerWindowFit, "compatible");
});

test("compatible duration alone does not fabricate a Summer 2027 season", () => {
  const assessment = assessOpportunityTrack({
    company: "Example",
    title: "Product Intern",
    location: "Bengaluru, India",
    description: "10 week internship with dates to be announced.",
  });
  assert.equal(assessment.summerWindowFit, "compatible");
  assert.equal(assessment.track, "other_internship");
});

test("long internships do not masquerade as a Summer 2027 fit", () => {
  const assessment = assessOpportunityTrack({
    company: "Example",
    title: "Product Management Intern",
    location: "Noida, India",
    description: "This is a 6 months internship.",
  });
  assert.equal(assessment.summerWindowFit, "mismatch");
  assert.notEqual(assessment.track, "summer_2027");
});

test("fellowships, research projects and permanent jobs stay out of internship tracks", () => {
  assert.equal(classifyOpportunityType({ company: "UN", title: "Student Fellowship", location: "Remote" }), "fellowship");
  assert.equal(assessOpportunityTrack({ company: "Lab", title: "Research Assistant", location: "Remote" }).track, "research");
  assert.equal(assessOpportunityTrack({ company: "Acme", title: "Business Analyst", location: "Mumbai" }).track, "jobs");
});

test("research internships remain internships rather than being diverted to professor projects", () => {
  const assessment = assessOpportunityTrack({ company: "Lab", title: "Research Intern", location: "Remote" });
  assert.equal(assessment.opportunityType, "internship");
  assert.equal(assessment.track, "now_remote");
});

test("culture watch is a soft signal and is broader than the three example brands", () => {
  const watchlist = new Set<string>(CULTURE_RELEVANT_BRAND_WATCHLIST);
  for (const expected of ["Roblox", "Nike", "Monster Energy", "Discord", "Spotify", "CRED", "Zepto"]) {
    assert.ok(watchlist.has(expected));
  }
  assert.equal(assessOpportunityTrack({ company: "Roblox", title: "Product Intern", location: "Remote" }).cultureSignal, "watchlist");
  assert.equal(assessOpportunityTrack({ company: "Indie Studio", title: "Product Intern", location: "Remote", focus: "gaming creator economy" }).cultureSignal, "culture_adjacent");
});

test("search-lane focus cannot manufacture remote or Summer 2027 fit", () => {
  const assessment = assessOpportunityTrack({
    company: "Example",
    title: "Product Intern",
    location: "Bengaluru, India",
    focus: "Remote Summer 2027 search lane",
  });
  assert.equal(assessment.isRemote, false);
  assert.equal(assessment.summerWindowFit, "unknown");
  assert.equal(assessment.track, "other_internship");
});

test("work authorization language is flagged rather than guessed", () => {
  const assessment = assessOpportunityTrack({
    company: "US Startup",
    title: "Operations Intern",
    location: "Remote",
    description: "Applicants must be authorized to work in the United States. Visa sponsorship is not available.",
  });
  assert.equal(assessment.eligibilityFlags.length, 1);
  assert.match(assessment.eligibilityFlags[0], /manual eligibility review/i);
});
