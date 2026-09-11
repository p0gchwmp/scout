import { selectUsableApprovedClaims } from "./claims.ts";
import { cleanJobText } from "./job-text.ts";
import { classifyRoleTaxonomy, type RoleFamilyId } from "./role-taxonomy.ts";

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
  id?: string;
  title: string;
  description: string;
  location: string;
};

type ThemeDefinition = {
  label: string;
  claim: RegExp;
  job: RegExp;
  families: readonly RoleFamilyId[];
};

const THEMES: readonly ThemeDefinition[] = [
  {
    label: "Product & operations",
    claim: /\b(product|operations?|workflow|requirements?|process|clinic|appointments?|billing)\b/i,
    job: /\b(product|operations?|workflow|process|onboard|customer success|service|procedures?)\b/i,
    families: ["product", "operations"],
  },
  {
    label: "Research & analysis",
    claim: /\b(research|analysis|analysed|analyzed|data review|policy report|synthesis|pharmacovigilance)\b/i,
    job: /\b(research|analysis|data|review|audit|annotat|insights?)\b/i,
    families: ["research", "analytics", "finance_economics", "business_strategy"],
  },
  {
    label: "Data & analytics",
    claim: /\b(data|analysis|analysed|analyzed|sql|python|spreadsheet|excel|dashboard|metrics?|review)\b/i,
    job: /\b(analyst|analytics?|data|sql|excel|spreadsheet|dashboard|metrics?|insights?|business intelligence|reporting|forecasting)\b/i,
    families: ["analytics", "finance_economics", "product", "operations", "business_strategy"],
  },
  {
    label: "Business & strategy",
    claim: /\b(strategy|business|market|commercial|growth|pricing|price|stakeholder|partnership|go[- ]?to[- ]?market|gtm)\b/i,
    job: /\b(strategy|business development|growth|go[- ]?to[- ]?market|gtm|partnership|commercial|market research|founder['’]?s office|business operations?)\b/i,
    families: ["business_strategy", "operations", "product"],
  },
  {
    label: "Finance & economics",
    claim: /\b(finance|financial|economic|economics|price|pricing|cost|market|budget|forecast|investment|valuation)\b/i,
    job: /\b(finance|financial|fp&a|investment|markets?|economics?|economic|pricing|revenue|valuation|budget|forecast|credit|risk)\b/i,
    families: ["finance_economics", "analytics", "business_strategy"],
  },
  {
    label: "Technical delivery",
    claim: /\b(software|node(?:\.js)?|express|python|javascript|django|wagtail|cms|prototype|git|deployment|api|database|sqlite|automation)\b/i,
    job: /\b(software|engineer|technical|technology|systems?|code|programming|cloud|ubuntu|linux|api|database|automation|integration)\b/i,
    families: ["technical_systems", "software_development"],
  },
  {
    label: "Implementation & systems",
    claim: /\b(workflow|system|prototype|implementation|api|database|sqlite|node|express|automation|testing|tests?|requirements?)\b/i,
    job: /\b(implementation|solutions?|systems?|automation|integrations?|technical operations?|technical program|technical project|qa|quality assurance|support engineer|workflow)\b/i,
    families: ["technical_systems", "product", "operations"],
  },
  {
    label: "Quality & documentation",
    claim: /\b(qa|testing|tests?|documentation|checklist|audit|review|validated?)\b/i,
    job: /\b(quality|testing|tests?|accuracy|documentation|audit|review|feedback|detail)\b/i,
    families: ["technical_systems", "operations", "research"],
  },
  {
    label: "Healthcare & public policy",
    claim: /\b(health|clinic|policy|pharmacovigilance|antibiotic|public health|patient)\b/i,
    job: /\b(health|clinic|policy|pharmacovigilance|antibiotic|public health|patient)\b/i,
    families: ["research", "operations", "business_strategy"],
  },
  {
    label: "Stakeholder support",
    claim: /\b(stakeholder|delegate|clinic|customer|patient|community|support)\b/i,
    job: /\b(customer|stakeholder|support|onboard|engage|collaborat|service)\b/i,
    families: ["operations", "product", "business_strategy"],
  },
] as const;

const THEME_BY_LABEL = new Map(THEMES.map((theme) => [theme.label, theme]));
const MAX_SUPPORTING_CLAIMS_PER_THEME = 3;
const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "been", "being", "from", "have", "into", "intern", "internship", "role", "that", "the", "their", "this", "through", "using", "with", "work", "your",
]);

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

const TECHNICAL_PRIMARY_TITLE = /\b(?:software|engineer(?:ing)?|infrastructure|platform|site reliability|sre|hardware|robotics)\b|\bit intern\b|\b(?:it|information technology)\s+(?:support|systems?|infrastructure|network)\b|\b(?:gadget|tech(?:nical)?)\s+support\b/i;
const EXPLICIT_TARGET_FUNCTION_TITLE = /\b(?:product (?:management|ops|operations|strategy)|strategy\s*(?:&|and)\s*operations|gtm|go[- ]?to[- ]?market|business development|business operations|revenue operations|customer operations|talent operations|admin(?:istration)?\s*(?:&|and)\s*operations|operations analyst|operations management|data operations|public finance|public policy|policy analysis|research analyst|finance|financial)\b/i;
const MARKETING_OR_COMMS_TITLE = /\b(?:marketing|communications?)\b/i;
const MARKETING_TARGET_OVERRIDE = /\b(?:analytics?|operations?)\b/i;

function isTechnicalPrimaryTitle(title: string) {
  return TECHNICAL_PRIMARY_TITLE.test(title) && !EXPLICIT_TARGET_FUNCTION_TITLE.test(title);
}

function isOutsideTargetMarketingTitle(title: string) {
  return MARKETING_OR_COMMS_TITLE.test(title) && !MARKETING_TARGET_OVERRIDE.test(title);
}

function tokens(value: string) {
  return [...new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{2,}/g) ?? [])
    .filter((token) => !STOP_WORDS.has(token)))];
}

function claimRelevanceScore(claim: ResumeClaimText, title: string, description: string) {
  const claimText = cleanJobText(`${claim.statement} ${claim.evidence}`).toLowerCase();
  const titleTokens = tokens(title);
  const roleTokens = tokens(description).slice(0, 100);
  let score = 0;
  for (const token of titleTokens) if (claimText.includes(token)) score += 5;
  for (const token of roleTokens) if (claimText.includes(token)) score += 1;
  return score;
}

export function evaluateResumeAlignment(job: JobText, claims: ResumeClaimText[]): ResumeAlignment {
  const approvedClaims = selectUsableApprovedClaims(claims, {
    allowSyntheticDemo: job.id?.startsWith("demo_job_") === true,
  }).filter((claim) => (
    claim.id.trim()
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

  const title = cleanJobText(job.title);
  const description = cleanJobText(job.description);
  const location = cleanJobText(job.location);
  const roleText = `${title} ${description}`.trim();
  const jobText = `${roleText} ${location}`.trim();
  const taxonomy = classifyRoleTaxonomy({ title, description });
  const titleTaxonomy = classifyRoleTaxonomy({ title, description: "" });

  const supportingClaims = THEMES.flatMap((theme) => {
    if (!theme.job.test(roleText)) return [];
    const claimIds = approvedClaims
      .filter((claim) => theme.claim.test(`${claim.statement} ${claim.evidence}`))
      .map((claim) => ({ id: claim.id, score: claimRelevanceScore(claim, title, description) }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, MAX_SUPPORTING_CLAIMS_PER_THEME)
      .map((claim) => claim.id);
    return claimIds.length ? [{ theme: theme.label, label: theme.label, claimIds }] : [];
  });
  const matches = supportingClaims.map((match) => match.theme);
  const distinctSupportingClaimIds = [...new Set(supportingClaims.flatMap((support) => support.claimIds))];
  const approvedClaimText = approvedClaims.map((claim) => `${claim.statement} ${claim.evidence}`).join(" ");
  const unmetRequirements = REQUIREMENT_GAPS
    .filter((requirement) => requirement.job.test(jobText) && !requirement.claim.test(approvedClaimText));
  const gaps = unmetRequirements.map((requirement) => requirement.message);
  const hasBlockingGap = unmetRequirements.some((requirement) => requirement.blocking);

  const titleFamilyId = titleTaxonomy.primaryFamily.id;
  const titleHasPrimarySignal = titleFamilyId !== "generalist";
  const primaryThemeSupported = titleHasPrimarySignal && supportingClaims.some((support) => (
    THEME_BY_LABEL.get(support.theme)?.families.includes(titleFamilyId) === true
  ));
  const titleOutsideTargetLane = isTechnicalPrimaryTitle(title) || isOutsideTargetMarketingTitle(title);

  const band: ResumeAlignmentBand = titleOutsideTargetLane || taxonomy.preferenceLane === "software_stretch" || titleTaxonomy.preferenceLane === "software_stretch"
    ? "stretch"
    : hasBlockingGap || gaps.length >= 2
      ? "stretch"
      : titleHasPrimarySignal && primaryThemeSupported && distinctSupportingClaimIds.length >= 2 && gaps.length === 0
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
    eligibilityGaps: supportingClaims.length ? gaps : ["No relevant approved claim overlap found for this posting"],
    basis: `${approvedClaims.length} approved resume claim${approvedClaims.length === 1 ? "" : "s"}`,
    notChecked: [...NOT_CHECKED],
    caveats: [...NOT_CHECKED],
  };
}
