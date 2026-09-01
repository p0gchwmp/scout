import { classifyRoleTaxonomy, ROLE_FAMILIES, type RoleFamilyId } from "./role-taxonomy.ts";

export const OUTCOME_LEARNING_CAPABILITIES = Object.freeze({
  explicitRecordedOutcomesOnly: true,
  submittedApplicationsOnly: true,
  minimumTotalOutcomes: 4,
  minimumFamilyOutcomes: 2,
  maximumAbsoluteNudge: 5,
  silenceMeansNegative: false,
  withdrawnMeansNegative: false,
  hardEligibilityUnaffected: true,
  evidenceTrustUnaffected: true,
  automaticRoleHiding: false,
  inferRecruiterBehavior: false,
  readGmailThreads: false,
  send: false,
  submit: false,
} as const);

export type OutcomeLearningJob = { id: string; title: string; description: string };
export type OutcomeLearningApplication = { id: string; jobId: string; status: string; submittedAt: string | null };

export type OutcomeFamilyLearning = {
  familyId: RoleFamilyId;
  familyLabel: string;
  sampleSize: number;
  replies: number;
  interviews: number;
  offers: number;
  rejections: number;
  neutral: number;
  adjustment: number;
  confidence: "none" | "emerging" | "established";
  supportingApplicationIds: string[];
};

export type OutcomeLearning = {
  active: boolean;
  totalSubmittedOutcomes: number;
  families: OutcomeFamilyLearning[];
  summary: string;
};

const MIN_TOTAL = OUTCOME_LEARNING_CAPABILITIES.minimumTotalOutcomes;
const MIN_FAMILY = OUTCOME_LEARNING_CAPABILITIES.minimumFamilyOutcomes;
const MAX_NUDGE = OUTCOME_LEARNING_CAPABILITIES.maximumAbsoluteNudge;

function outcomeWeight(status: string) {
  switch (status) {
    case "recruiter_replied": return 1;
    case "interview": return 2;
    case "offer": return 3;
    case "rejected": return -1;
    case "awaiting_reply":
    case "withdrawn": return 0;
    default: return null;
  }
}

export function buildOutcomeLearning(
  jobs: readonly OutcomeLearningJob[],
  applications: readonly OutcomeLearningApplication[],
): OutcomeLearning {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const rows = applications.filter((application) => Boolean(application.submittedAt) && jobsById.has(application.jobId) && outcomeWeight(application.status) !== null);
  const totalSubmittedOutcomes = rows.length;
  const active = totalSubmittedOutcomes >= MIN_TOTAL;

  const grouped = new Map<RoleFamilyId, OutcomeLearningApplication[]>();
  for (const application of rows) {
    const job = jobsById.get(application.jobId)!;
    const familyId = classifyRoleTaxonomy(job).primaryFamily.id;
    const family = grouped.get(familyId) ?? [];
    family.push(application);
    grouped.set(familyId, family);
  }

  const families = ROLE_FAMILIES.map((family): OutcomeFamilyLearning => {
    const familyRows = grouped.get(family.id) ?? [];
    const sampleSize = familyRows.length;
    const replies = familyRows.filter((row) => row.status === "recruiter_replied").length;
    const interviews = familyRows.filter((row) => row.status === "interview").length;
    const offers = familyRows.filter((row) => row.status === "offer").length;
    const rejections = familyRows.filter((row) => row.status === "rejected").length;
    const neutral = familyRows.filter((row) => row.status === "awaiting_reply" || row.status === "withdrawn").length;
    const raw = familyRows.reduce((sum, row) => sum + (outcomeWeight(row.status) ?? 0), 0);
    const adjustment = active && sampleSize >= MIN_FAMILY ? Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, raw)) : 0;
    return {
      familyId: family.id,
      familyLabel: family.label,
      sampleSize,
      replies,
      interviews,
      offers,
      rejections,
      neutral,
      adjustment,
      confidence: sampleSize >= 5 ? "established" : sampleSize >= MIN_FAMILY ? "emerging" : "none",
      supportingApplicationIds: familyRows.map((row) => row.id),
    };
  });

  return {
    active,
    totalSubmittedOutcomes,
    families,
    summary: active
      ? `Outcome learning is active from ${totalSubmittedOutcomes} explicitly recorded submitted application${totalSubmittedOutcomes === 1 ? "" : "s"}. Nudges stay soft and cannot override eligibility or evidence.`
      : `Scout needs ${Math.max(0, MIN_TOTAL - totalSubmittedOutcomes)} more explicitly recorded submitted application outcome${MIN_TOTAL - totalSubmittedOutcomes === 1 ? "" : "s"} before outcome nudges activate.`,
  };
}

export function outcomeNudgeForFamily(learning: OutcomeLearning | undefined, familyId: RoleFamilyId) {
  return learning?.families.find((family) => family.familyId === familyId)?.adjustment ?? 0;
}
