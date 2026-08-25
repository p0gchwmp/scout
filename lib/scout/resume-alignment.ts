import { classifyRoleTaxonomy } from "./role-taxonomy.ts";

export type ResumeClaimText = {
  id: string;
  statement: string;
  evidence: string;
  status: "draft" | "approved" | "rejected";
};

export type ResumeAlignmentBand = "strong" | "partial" | "stretch" | "unranked";

export type ResumeSupportingClaims = {
  theme: string;
  label: string;
  claimIds: string[];
};

export type ResumeAlignment = {
  band: ResumeAlignmentBand;
  label: string;
  matches: string[];
  supportingClaims: ResumeSupportingClaims[];
  gaps: string[];
  eligibilityGaps: string[];
  basis: string;
  notChecked: string[];
  caveats: string[];
};

type JobText = {
  title: string;
  description: string;
  location: string;
};

const THEMES = [
  {
    label: "Product & operations",
    claim: /\b(product|operations?|workflow|requirements?|process|clinic|appointments?|billing)\b/i,
    job: /\b(product|operations?|workflow|process|onboard|customer success|service|procedures?)\b/i,
  },
  {
    label: "Research & analysis",
    claim: /\b(research|analysis|analysed|analyzed|data review|policy report|synthesis|pharmacovigilance)\b/i,
    job: /\b(research|analysis|data|review|audit|annotat|insights?)\b/i,
  },
  {
    label: "Data & analytics",
    claim: /\b(data|analysis|analysed|analyzed|sql|python|spreadsheet|excel|dashboard|metrics?|review)\b/i,
    job: /\b(analyst|analytics?|data|sql|excel|spreadsheet|dashboard|metrics?|insights?|business intelligence|reporting|forecasting)\b/i,
  },
  {
    label: "Business & strategy",
    claim: /\b(strategy|business|market|commercial|growth|pricing|price|stakeholder|partnership|go[- ]?to[- ]?market|gtm)\b/i,
    job: /\b(strategy|business development|growth|go[- ]?to[- ]?market|gtm|partnership|commercial|market research|founder['’]?s office|business operations?)\b/i,
  },
  {
    label: "Finance & economics",
    claim: /\b(finance|financial|economic|economics|price|pricing|cost|market|budget|forecast|investment|valuation)\b/i,
    job: /\b(finance|financial|fp&a|investment|markets?|economics?|economic|pricing|revenue|valuation|budget|forecast|credit|risk)\b/i,
  },
  {
    label: "Technical delivery",
    claim: /\b(software|node(?:\.js)?|express|python|javascript|django|wagtail|cms|prototype|git|deployment|api|database|sqlite|automation)\b/i,
    job: /\b(software|engineer|technical|technology|systems?|code|programming|cloud|ubuntu|linux|api|database|automation|integration)\b/i,
  },
  {
    label: "Implementation & systems",
    claim: /\b(workflow|system|prototype|implementation|api|database|sqlite|node|express|automation|testing|tests?|requirements?)\b/i,
    job: /\b(implementation|solutions?|systems?|automation|integrations?|technical operations?|technical program|technical project|qa|quality assurance|support engineer|workflow)\b/i,
  },
  {
    label: "Quality & documentation",
    claim: /\b(qa|testing|tests?|documentation|checklist|audit|review|validated?)\b/i,
    job: /\b(quality|testing|tests?|accuracy|documentation|audit|review|feedback|detail)\b/i,
  },
  {
    label: "Healthcare & public policy",
    claim: /\b(health|clinic|policy|pharmacovigilance|antibiotic|public health|patient)\b/i,
    job: /\b(health|clinic|policy|pharmacovigilance|antibiotic|public health|patient)\b/i,
  },
  {
    label: "Stakeholder support",
    claim: /\b(stakeholder|delegate|clinic|customer|patient|community|support)\b/i,
    job: /\b(customer|stakeholder|support|onboard|engage|collaborat|service)\b/i,
  },
] as const;

const REQUIREMENT_GAPS = [
  {
    job: /\bdriver['’]?s licen[cs]e\b/i,
    claim: /\bdriver['’]?s licen[cs]e\b/i,
    message: "Driver's licence is required but is not evidenced in approved resume claims",
    blocking: true,
  },
  {
    job: /\b(?:degree|bachelor['’]?s|master['’]?s|phd).{0,70}\bcomputer science\b|\bcomputer science.{0,70}\b(?:degree|bachelor['’]?s|master['’]?s|phd)\b/i,
    claim: /\bcomputer science\b/i,
    message: "A computer-science-related degree is requested but is not evidenced in approved resume claims",
    blocking: true,
  },
  {
    job: /\bcustomer[- ]facing experience\b/i,
    claim: /\bcustomer[- ]facing\b/i,
    message: "Direct customer-facing experience is requested but is not explicit in approved resume claims",
    blocking: false,
  },
] as const;

const NOT_CHECKED = [
  "Work authorization",
  "Availability",
  "Recruiter preference",
] as const;

export function evaluateResumeAlignment(job: JobText, claims: ResumeClaimText[]): ResumeAlignment {
  const approvedClaims = claims.filter((claim) => (
    claim.status === "approved"
    && claim.id.trim()
    && claim.statement.trim()
    && claim.evidence.trim()
  ));

  if (!approvedClaims.length) {
    return {
      band: "unranked",
      label: "Resume lens unavailable",
      matches: [],
      supportingClaims: [],
      gaps: [],
      eligibilityGaps: [],
      basis: "No approved resume claims",
      notChecked: [...NOT_CHECKED],
      caveats: [...NOT_CHECKED],
    };
  }

  const jobText = `${job.title} ${job.description} ${job.location}`.replace(/<[^>]+>/g, " ");
  const supportingClaims = THEMES.flatMap((theme) => {
    if (!theme.job.test(jobText)) return [];
    const claimIds = approvedClaims
      .filter((claim) => theme.claim.test(`${claim.statement} ${claim.evidence}`))
      .map((claim) => claim.id)
      .sort();
    return claimIds.length ? [{ theme: theme.label, label: theme.label, claimIds }] : [];
  });
  const matches = supportingClaims.map((match) => match.theme);
  const distinctSupportingClaimIds = [...new Set(supportingClaims.flatMap((support) => support.claimIds))];
  const approvedClaimText = approvedClaims.map((claim) => `${claim.statement} ${claim.evidence}`).join(" ");
  const unmetRequirements = REQUIREMENT_GAPS
    .filter((requirement) => requirement.job.test(jobText) && !requirement.claim.test(approvedClaimText));
  const gaps = unmetRequirements.map((requirement) => requirement.message);
  const hasBlockingGap = unmetRequirements.some((requirement) => requirement.blocking);
  const taxonomy = classifyRoleTaxonomy({ title: job.title, description: job.description });

  const band: ResumeAlignmentBand = taxonomy.preferenceLane === "software_stretch"
    ? "stretch"
    : hasBlockingGap || gaps.length >= 2
      ? "stretch"
      : matches.length >= 4 && distinctSupportingClaimIds.length >= 2 && gaps.length === 0
        ? "strong"
        : matches.length >= 2
          ? "partial"
          : "stretch";
  const labels: Record<Exclude<ResumeAlignmentBand, "unranked">, string> = {
    strong: "Strong evidence overlap",
    partial: "Partial evidence overlap",
    stretch: "Stretch role",
  };

  return {
    band,
    label: labels[band],
    matches,
    supportingClaims,
    gaps,
    eligibilityGaps: gaps,
    basis: `${approvedClaims.length} approved resume claim${approvedClaims.length === 1 ? "" : "s"}`,
    notChecked: [...NOT_CHECKED],
    caveats: [...NOT_CHECKED],
  };
}
