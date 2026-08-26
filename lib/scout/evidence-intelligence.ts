import {
  APPLICATION_PROFILE_KEYS,
  REQUIRED_APPLICATION_PROFILE_KEYS,
  type ApplicationProfileField,
} from "./application-prep.ts";
import { hasUnanchoredStatementNumbers, isSyntheticDemoClaim, selectUsableApprovedClaims } from "./claims.ts";
import { evaluateResumeAlignment, type ResumeClaimText } from "./resume-alignment.ts";
import { ROLE_FAMILIES, type RoleFamilyId } from "./role-taxonomy.ts";

export const EVIDENCE_INTELLIGENCE_CAPABILITIES = Object.freeze({
  readOnlyDiagnostics: true,
  approvedClaimsOnlyForCoverage: true,
  approvedClaimsOnlyForRoleUsage: true,
  possibleDuplicateDetection: true,
  autoMergeClaims: false,
  autoApproveClaims: false,
  inferMissingExperience: false,
  rewriteApprovedClaims: false,
} as const);

export type EvidenceClaim = ResumeClaimText & {
  version: number;
  approvedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type EvidenceJob = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  lifecycleState: "active" | "closed";
  state: "shortlisted" | "saved" | "rejected";
};

export type ClaimFormQuality = "clear" | "review" | "thin";

export type ClaimEvidenceAssessment = {
  claimId: string;
  formQuality: ClaimFormQuality;
  formQualityLabel: string;
  roleFamilyIds: RoleFamilyId[];
  roleFamilyLabels: string[];
  issues: string[];
  cautions: string[];
  activeOpportunityCount: number;
  activeOpportunities: Array<{ id: string; company: string; title: string }>;
  possibleDuplicateClaimIds: string[];
};

export type EvidenceFamilyCoverage = {
  id: RoleFamilyId;
  label: string;
  shortLabel: string;
  preferenceLane: "broad_fit" | "software_stretch";
  supported: boolean;
  claimIds: string[];
  note: string;
};

const FAMILY_PATTERNS: Readonly<Record<Exclude<RoleFamilyId, "generalist">, RegExp>> = Object.freeze({
  product: /\b(?:product|requirements?|workflow|user research|feature|prototype|customer discovery|roadmap)\b/i,
  analytics: /\b(?:data review|data|analysis|analysed|analyzed|sql|python|excel|spreadsheet|dashboard|metrics?|reporting|insights?)\b/i,
  business_strategy: /\b(?:strategy|business|market research|competitive research|pricing|price|commercial|growth|stakeholder|partnership|go[- ]?to[- ]?market|gtm)\b/i,
  finance_economics: /\b(?:finance|financial|economics?|economic|pricing|price|cost|budget|forecast|valuation|investment|credit|markets?)\b/i,
  operations: /\b(?:operations?|workflow|process|clinic|appointments?|billing|program|project|logistics|coordination|service operations?)\b/i,
  research: /\b(?:research|desk research|literature review|data review|review|synthesis|pharmacovigilance|policy|governance|stewardship|pilot|questionnaire|exploratory|study|evidence)\b/i,
  technical_systems: /\b(?:node(?:\.js)?|express|sqlite|database|api|prototype|automation|systems?|implementation|testing|tests?|qa|cms|git|deployment|workflow mapping)\b/i,
  software_development: /\b(?:software|coding|code|javascript|python|node(?:\.js)?|express|django|wagtail|git|deployment|backend|frontend|full[- ]?stack)\b/i,
});

const HIGH_STAKES_LANGUAGE = /\b(?:cgpa|gpa|degree|licensed?|certified|citizen|citizenship|work authorization|visa|sponsorship|driver['’]?s licen[cs]e)\b/i;
const NUMBER_TOKEN = /(?:₹|\$|€|£)?\d+(?:\.\d+)?%?/g;
const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with",
  "work", "worked", "project", "supported", "prepared", "helped", "experience", "using", "built", "developed",
]);

function words(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function normalizeTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function roleSupport(statement: string) {
  const matched = (Object.entries(FAMILY_PATTERNS) as Array<[Exclude<RoleFamilyId, "generalist">, RegExp]>)
    .filter(([, pattern]) => pattern.test(statement))
    .map(([id]) => id);
  return matched.length ? matched : ["generalist" as const];
}

function claimFormDiagnostics(claim: EvidenceClaim, familyIds: RoleFamilyId[]) {
  const issues: string[] = [];
  const cautions: string[] = [];
  const statementWords = words(claim.statement).length;
  const evidenceWords = words(claim.evidence).length;

  if (statementWords < 6 || claim.statement.trim().length < 35) {
    issues.push("Claim statement is terse; role matching may be weaker than the underlying experience.");
  }
  if (evidenceWords < 6 || claim.evidence.trim().length < 35) {
    issues.push("Evidence is terse; external reuse should stay conservative until the support is clearer.");
  }
  if (familyIds.length === 1 && familyIds[0] === "generalist") {
    issues.push("No broad role-family signal is currently detectable from this claim text.");
  }
  if (HIGH_STAKES_LANGUAGE.test(`${claim.statement} ${claim.evidence}`)) {
    cautions.push("Contains credential or eligibility language; preserve exact evidence and never infer beyond it.");
  }
  const statementNumbers = new Set(claim.statement.match(NUMBER_TOKEN) ?? []);
  const evidenceNumbers = new Set(claim.evidence.match(NUMBER_TOKEN) ?? []);
  if ([...statementNumbers].some((number) => !evidenceNumbers.has(number))) {
    cautions.push("Statement contains a number or metric not repeated in the evidence text; verify it before external use.");
  }
  if (isSyntheticDemoClaim(claim)) {
    cautions.push("Synthetic local-demo evidence is diagnostic only and is ignored when real approved evidence is available.");
  }
  if (claim.status !== "approved") {
    cautions.push(`${claim.status === "draft" ? "Draft" : "Rejected"} claim is ignored by ranking, application packets, and outreach grounding.`);
  }

  const formQuality: ClaimFormQuality = issues.length >= 2 ? "thin" : issues.length === 1 ? "review" : "clear";
  const labels: Record<ClaimFormQuality, string> = {
    clear: "Clear evidence form",
    review: "Review wording/evidence",
    thin: "Thin evidence form",
  };
  return { issues, cautions, formQuality, formQualityLabel: labels[formQuality] };
}

function similarity(left: EvidenceClaim, right: EvidenceClaim) {
  const leftStatement = normalizeTokens(left.statement).join(" ");
  const rightStatement = normalizeTokens(right.statement).join(" ");
  if (leftStatement && leftStatement === rightStatement) return 1;

  const a = new Set(normalizeTokens(`${left.statement} ${left.evidence}`));
  const b = new Set(normalizeTokens(`${right.statement} ${right.evidence}`));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  if (intersection < 4) return 0;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function findPossibleDuplicateClaims(claims: EvidenceClaim[]) {
  const candidates = claims.filter((claim) => claim.status !== "rejected");
  const pairs: Array<{ claimIds: [string, string]; similarity: number }> = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const score = similarity(candidates[leftIndex], candidates[rightIndex]);
      if (score >= 0.72) {
        pairs.push({
          claimIds: [candidates[leftIndex].id, candidates[rightIndex].id],
          similarity: Math.round(score * 100) / 100,
        });
      }
    }
  }
  return pairs.sort((left, right) => right.similarity - left.similarity || left.claimIds[0].localeCompare(right.claimIds[0]));
}

export function buildEvidenceIntelligence(input: {
  claims: EvidenceClaim[];
  profileFields: ApplicationProfileField[];
  jobs: EvidenceJob[];
}) {
  const rawApprovedClaims = input.claims.filter((claim) => claim.status === "approved");
  const demoOnlyWorkspace = input.jobs.length > 0 && input.jobs.every((job) => job.id.startsWith("demo_job_"));
  const approvedClaims = selectUsableApprovedClaims(input.claims, { allowSyntheticDemo: demoOnlyWorkspace });
  const approvedClaimIds = new Set(approvedClaims.map((claim) => claim.id));
  const ignoredSyntheticApprovedClaims = rawApprovedClaims.filter((claim) => !approvedClaimIds.has(claim.id) && isSyntheticDemoClaim(claim));
  const ignoredUnanchoredNumericApprovedClaims = rawApprovedClaims.filter((claim) => !approvedClaimIds.has(claim.id) && !isSyntheticDemoClaim(claim) && hasUnanchoredStatementNumbers(claim));
  const duplicatePairs = findPossibleDuplicateClaims(input.claims);
  const duplicatesByClaim = new Map<string, string[]>();
  for (const pair of duplicatePairs) {
    const [left, right] = pair.claimIds;
    duplicatesByClaim.set(left, [...(duplicatesByClaim.get(left) ?? []), right]);
    duplicatesByClaim.set(right, [...(duplicatesByClaim.get(right) ?? []), left]);
  }

  const usageByClaim = new Map<string, Array<{ id: string; company: string; title: string }>>();
  for (const job of input.jobs.filter((job) => job.lifecycleState === "active" && job.state !== "rejected")) {
    const alignment = evaluateResumeAlignment(job, input.claims);
    const claimIds = new Set(alignment.supportingClaims.flatMap((support) => support.claimIds));
    for (const claimId of claimIds) {
      const current = usageByClaim.get(claimId) ?? [];
      current.push({ id: job.id, company: job.company, title: job.title });
      usageByClaim.set(claimId, current);
    }
  }

  const claimAssessments: ClaimEvidenceAssessment[] = input.claims.map((claim) => {
    const familyIds = roleSupport(claim.statement);
    const diagnostics = claimFormDiagnostics(claim, familyIds);
    const familyLabels = familyIds.map((id) => ROLE_FAMILIES.find((family) => family.id === id)?.label ?? id);
    const activeOpportunities = usageByClaim.get(claim.id) ?? [];
    return {
      claimId: claim.id,
      formQuality: diagnostics.formQuality,
      formQualityLabel: diagnostics.formQualityLabel,
      roleFamilyIds: familyIds,
      roleFamilyLabels: familyLabels,
      issues: diagnostics.issues,
      cautions: diagnostics.cautions,
      activeOpportunityCount: activeOpportunities.length,
      activeOpportunities: activeOpportunities.slice(0, 8),
      possibleDuplicateClaimIds: [...new Set(duplicatesByClaim.get(claim.id) ?? [])].sort(),
    };
  });

  const approvedAssessmentById = new Map(claimAssessments
    .filter((assessment) => approvedClaimIds.has(assessment.claimId))
    .map((assessment) => [assessment.claimId, assessment]));

  const familyCoverage: EvidenceFamilyCoverage[] = ROLE_FAMILIES
    .filter((family) => family.id !== "generalist")
    .map((family) => {
      const claimIds = approvedClaims
        .filter((claim) => approvedAssessmentById.get(claim.id)?.roleFamilyIds.includes(family.id))
        .map((claim) => claim.id)
        .sort();
      const software = family.id === "software_development";
      return {
        id: family.id,
        label: family.label,
        shortLabel: family.shortLabel,
        preferenceLane: software ? "software_stretch" as const : "broad_fit" as const,
        supported: claimIds.length > 0,
        claimIds,
        note: claimIds.length
          ? `${claimIds.length} approved claim${claimIds.length === 1 ? "" : "s"} currently support this family.`
          : `No approved evidence currently maps to ${family.label}; this is an evidence gap, not a claim about your real-world ability.`,
      };
    });

  const fieldByKind = new Map(input.profileFields.map((field) => [field.kind, field]));
  const profileCoverage = APPLICATION_PROFILE_KEYS.map((kind) => {
    const field = fieldByKind.get(kind);
    const required = REQUIRED_APPLICATION_PROFILE_KEYS.includes(kind);
    const verified = Boolean(field?.verified && field.claim.trim());
    return {
      kind,
      required,
      verified,
      present: Boolean(field?.claim.trim()),
      evidencePresent: Boolean(field?.evidence.trim()),
      updatedAt: field?.updatedAt ?? null,
    };
  });
  const missingRequiredProfileKeys = profileCoverage.filter((field) => field.required && !field.verified).map((field) => field.kind);
  const verifiedRequiredProfileCount = profileCoverage.filter((field) => field.required && field.verified).length;
  const broadCoverage = familyCoverage.filter((family) => family.preferenceLane === "broad_fit");
  const supportedBroadFamilies = broadCoverage.filter((family) => family.supported).length;
  const activeOpportunityUsageCount = [...usageByClaim.values()].reduce((total, opportunities) => total + opportunities.length, 0);

  return {
    claimAssessments,
    familyCoverage,
    duplicatePairs,
    profileCoverage,
    missingRequiredProfileKeys,
    summary: {
      approvedClaims: rawApprovedClaims.length,
      usableApprovedClaims: approvedClaims.length,
      rawApprovedClaims: rawApprovedClaims.length,
      ignoredSyntheticApprovedClaims: ignoredSyntheticApprovedClaims.length,
      ignoredUnanchoredNumericApprovedClaims: ignoredUnanchoredNumericApprovedClaims.length,
      draftClaims: input.claims.filter((claim) => claim.status === "draft").length,
      rejectedClaims: input.claims.filter((claim) => claim.status === "rejected").length,
      clearApprovedClaims: claimAssessments.filter((assessment) => assessment.formQuality === "clear" && approvedClaimIds.has(assessment.claimId)).length,
      supportedBroadFamilies,
      broadFamilyCount: broadCoverage.length,
      verifiedRequiredProfileCount,
      requiredProfileCount: REQUIRED_APPLICATION_PROFILE_KEYS.length,
      activeOpportunityUsageCount,
      possibleDuplicatePairs: duplicatePairs.length,
    },
    nextEvidenceActions: [
      ...(input.claims.some((claim) => claim.status === "draft") ? ["Review draft claims before expecting them to influence ranking or applications."] : []),
      ...(missingRequiredProfileKeys.length ? [`Verify ${missingRequiredProfileKeys.length} required application profile field${missingRequiredProfileKeys.length === 1 ? "" : "s"}.`] : []),
      ...(ignoredSyntheticApprovedClaims.length ? [`${ignoredSyntheticApprovedClaims.length} synthetic local-demo approved claim${ignoredSyntheticApprovedClaims.length === 1 ? " is" : "s are"} ignored because real approved evidence is available.`] : []),
      ...(ignoredUnanchoredNumericApprovedClaims.length ? [`${ignoredUnanchoredNumericApprovedClaims.length} approved claim${ignoredUnanchoredNumericApprovedClaims.length === 1 ? " has" : "s have"} numbers or metrics not anchored in the evidence text and are ignored until re-evidenced.`] : []),
      ...(duplicatePairs.length ? ["Review possible overlapping claims; Scout will not merge them automatically."] : []),
      ...(claimAssessments.some((assessment) => assessment.issues.length && approvedClaimIds.has(assessment.claimId)) ? ["If an approved claim needs improvement, create a new draft revision rather than editing the immutable approved claim."] : []),
    ],
  };
}
