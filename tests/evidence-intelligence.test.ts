import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceIntelligence,
  EVIDENCE_INTELLIGENCE_CAPABILITIES,
  findPossibleDuplicateClaims,
  type EvidenceClaim,
} from "../lib/scout/evidence-intelligence.ts";

const claims: EvidenceClaim[] = [
  {
    id: "claim-clinic",
    status: "approved",
    version: 3,
    statement: "Mapped clinic operations workflows and product requirements for a prototype.",
    evidence: "Node.js, Express, SQLite prototype with workflow mapping, edge cases and automated tests.",
  },
  {
    id: "claim-adr",
    status: "approved",
    version: 2,
    statement: "Reviewed adverse-drug-reaction data and prepared technical documentation.",
    evidence: "GMC Jammu work included data review and documented pharmacovigilance observations.",
  },
  {
    id: "claim-pricing",
    status: "approved",
    version: 1,
    statement: "Completed antibiotic price desk research for a structured comparison.",
    evidence: "Desk research compared antibiotic pricing information and documented the findings.",
  },
  {
    id: "claim-sql-draft",
    status: "draft",
    version: 1,
    statement: "Advanced SQL analyst with production dashboard ownership.",
    evidence: "Unreviewed draft evidence only.",
  },
];

const profileFields = [
  { id: "p1", kind: "full_name", claim: "Ryan", evidence: "Resume", verified: true },
  { id: "p2", kind: "email", claim: "ryan@example.com", evidence: "Owner supplied", verified: true },
  { id: "p3", kind: "current_location", claim: "India", evidence: "Owner supplied", verified: true },
  { id: "p4", kind: "university", claim: "IIM Sambalpur", evidence: "Owner supplied", verified: true },
  { id: "p5", kind: "program", claim: "Bachelor of Science (B.S.) in Management and Public Policy", evidence: "Owner supplied", verified: true },
];

const jobs = [
  {
    id: "job-1",
    company: "Acme",
    title: "Implementation Analyst Intern",
    description: "Support APIs, workflow implementation, testing and data analysis.",
    location: "Remote",
    lifecycleState: "active" as const,
    state: "shortlisted" as const,
  },
  {
    id: "job-2",
    company: "Beta",
    title: "Financial Analyst Intern",
    description: "Pricing analysis, forecasting and market research.",
    location: "Mumbai, India",
    lifecycleState: "active" as const,
    state: "saved" as const,
  },
];

test("evidence coverage uses approved claims only and keeps broad role families separate", () => {
  const result = buildEvidenceIntelligence({ claims, profileFields, jobs });
  const analytics = result.familyCoverage.find((family) => family.id === "analytics")!;
  const technical = result.familyCoverage.find((family) => family.id === "technical_systems")!;
  const finance = result.familyCoverage.find((family) => family.id === "finance_economics")!;
  const software = result.familyCoverage.find((family) => family.id === "software_development")!;

  assert.ok(analytics.claimIds.includes("claim-adr"));
  assert.ok(!analytics.claimIds.includes("claim-sql-draft"));
  assert.ok(technical.claimIds.includes("claim-clinic"));
  assert.ok(finance.claimIds.includes("claim-pricing"));
  assert.equal(software.preferenceLane, "software_stretch");
  assert.equal(result.summary.approvedClaims, 3);
  assert.equal(result.summary.draftClaims, 1);
});

test("generic research does not masquerade as finance evidence", () => {
  const generic: EvidenceClaim = {
    id: "generic",
    status: "approved",
    version: 1,
    statement: "Conducted desk research and summarized findings for a report.",
    evidence: "Reviewed public sources and produced a concise research summary.",
  };
  const result = buildEvidenceIntelligence({ claims: [generic], profileFields: [], jobs: [] });
  const assessment = result.claimAssessments.find((item) => item.claimId === "generic")!;
  assert.ok(assessment.roleFamilyIds.includes("research"));
  assert.ok(!assessment.roleFamilyIds.includes("finance_economics"));
  assert.equal(result.familyCoverage.find((family) => family.id === "finance_economics")?.supported, false);
});

test("claim usage counts only exact approved claim ids used by active role alignment", () => {
  const result = buildEvidenceIntelligence({ claims, profileFields, jobs });
  const clinic = result.claimAssessments.find((item) => item.claimId === "claim-clinic")!;
  const draft = result.claimAssessments.find((item) => item.claimId === "claim-sql-draft")!;
  assert.ok(clinic.activeOpportunityCount >= 1);
  assert.equal(draft.activeOpportunityCount, 0);
});

test("profile intelligence keeps conditional graduation year outside required reusable fields", () => {
  const result = buildEvidenceIntelligence({ claims, profileFields, jobs: [] });
  assert.equal(result.summary.verifiedRequiredProfileCount, 5);
  assert.equal(result.summary.requiredProfileCount, 6);
  assert.deepEqual(result.missingRequiredProfileKeys, ["resume_reference"]);
  const graduation = result.profileCoverage.find((field) => field.kind === "graduation_year")!;
  assert.equal(graduation.required, false);
});

test("possible duplicate claims are review-only and never auto-merged", () => {
  const duplicateClaims: EvidenceClaim[] = [
    {
      id: "a",
      status: "approved",
      version: 1,
      statement: "Mapped clinic workflows and documented operational requirements for a prototype.",
      evidence: "Clinic workflow mapping, operational requirements, edge cases and prototype testing.",
    },
    {
      id: "b",
      status: "draft",
      version: 1,
      statement: "Mapped clinic workflow and operational requirements for the prototype.",
      evidence: "Clinic workflow mapping, operational requirements, prototype testing and edge cases.",
    },
  ];
  const pairs = findPossibleDuplicateClaims(duplicateClaims);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].claimIds, ["a", "b"]);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.autoMergeClaims, false);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.autoApproveClaims, false);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.inferMissingExperience, false);
});

test("credential-like and unmatched numeric language is surfaced as caution rather than invented validation", () => {
  const sensitive: EvidenceClaim = {
    id: "credential",
    status: "draft",
    version: 1,
    statement: "CGPA 8.25 and certified analyst with 25% improvement.",
    evidence: "Unverified academic and project note pending documentary review.",
  };
  const result = buildEvidenceIntelligence({ claims: [sensitive], profileFields: [], jobs: [] });
  const assessment = result.claimAssessments[0];
  assert.ok(assessment.cautions.some((item) => /credential or eligibility/i.test(item)));
  assert.ok(assessment.cautions.some((item) => /number or metric/i.test(item)));
  assert.ok(assessment.cautions.some((item) => /Draft claim is ignored/i.test(item)));
});

test("real approved claims suppress synthetic demo copies from coverage and usage", () => {
  const demo: EvidenceClaim = {
    id: "demo_claim_gmc",
    status: "approved",
    version: 1,
    statement: "Supported adverse-drug-reaction data review and technical documentation, and conducted desk research on antibiotic price disparities in India.",
    evidence: "LOCAL DEMO ONLY — derived from Scout's approved resume-boundary handoff; replace/review against source documents before any external use.",
  };
  const real: EvidenceClaim = {
    id: "resume-gmc",
    status: "approved",
    version: 1,
    statement: demo.statement,
    evidence: "Ryan_Vivek_Mahajan_Master_Resume.docx and README_Resume_Notes.md",
  };
  const result = buildEvidenceIntelligence({ claims: [demo, real], profileFields: [], jobs });
  assert.equal(result.summary.rawApprovedClaims, 2);
  assert.equal(result.summary.approvedClaims, 2);
  assert.equal(result.summary.usableApprovedClaims, 1);
  assert.equal(result.summary.ignoredSyntheticApprovedClaims, 1);
  assert.equal(result.claimAssessments.find((item) => item.claimId === demo.id)?.activeOpportunityCount, 0);
  assert.ok(result.familyCoverage.every((family) => !family.claimIds.includes(demo.id)));
});

test("provenance boilerplate cannot create research coverage by itself", () => {
  const claim: EvidenceClaim = {
    id: "resume-cms",
    status: "approved",
    version: 1,
    statement: "Directed product and design and AI-assisted delivery of a clinic website and CMS.",
    evidence: "Review source documents before external use.",
  };
  const result = buildEvidenceIntelligence({ claims: [claim], profileFields: [], jobs: [] });
  const assessment = result.claimAssessments[0];
  assert.ok(!assessment.roleFamilyIds.includes("research"));
});

test("approved claims with unanchored numbers are excluded from usable evidence", () => {
  const risky: EvidenceClaim = {
    id: "resume-education",
    status: "approved",
    version: 1,
    statement: "Bachelor of Science student, expected 2029; Semester I CGPA 8.25.",
    evidence: "Resume file reference pending exact documentary verification.",
  };
  const safe: EvidenceClaim = {
    id: "resume-policy",
    status: "approved",
    version: 1,
    statement: "Prepared public-policy coursework analysing antimicrobial-resistance governance.",
    evidence: "Coursework source artifact.",
  };
  const result = buildEvidenceIntelligence({ claims: [risky, safe], profileFields: [], jobs: [] });
  assert.equal(result.summary.rawApprovedClaims, 2);
  assert.equal(result.summary.approvedClaims, 2);
  assert.equal(result.summary.usableApprovedClaims, 1);
  assert.equal(result.summary.ignoredUnanchoredNumericApprovedClaims, 1);
  assert.ok(result.familyCoverage.every((family) => !family.claimIds.includes(risky.id)));
});
