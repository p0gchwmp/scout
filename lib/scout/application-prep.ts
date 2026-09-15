import { classifyApplicationUrl } from "./application-sites.ts";
import { buildApplicationProfileBindings } from "./application-profile-bindings.ts";
import { assessAvailability, type AvailabilityAssessment } from "./availability-eligibility.ts";
import { selectUsableApprovedClaims } from "./claims.ts";

export const APPLICATION_PREP_CAPABILITIES = Object.freeze({ prepare: true, submit: false, browserMutation: false } as const);

export const APPLICATION_PREP_PROFILE_BINDING_POLICY = Object.freeze({
  pinVerifiedProfileEvidence: true,
} as const);

export const APPLICATION_PROFILE_KEYS = [
  "full_name", "email", "phone", "current_location", "university", "program", "graduation_year",
  "linkedin_url", "github_url", "portfolio_url", "resume_reference",
] as const;

export type ApplicationProfileKey = (typeof APPLICATION_PROFILE_KEYS)[number];
export type ApplicationProfileField = { id: string; kind: string; claim: string; evidence: string; verified: boolean; updatedAt?: string };
export type PrepJob = {
  id: string;
  company: string;
  title: string;
  canonicalUrl: string;
  currentSnapshotId: string | null;
  description?: string | null;
  location?: string | null;
  workplaceType?: string | null;
};
export type PrepClaim = { id: string; statement: string; evidence?: string; status: "draft" | "approved" | "rejected" };

export const REQUIRED_APPLICATION_PROFILE_KEYS: readonly ApplicationProfileKey[] = Object.freeze([
  "full_name", "email", "university", "program", "resume_reference",
]);

export const ALWAYS_CONFIRM_APPLICATION_FIELDS = Object.freeze([
  "graduation_year", "work_authorization", "visa_or_sponsorship", "salary_or_compensation", "availability",
  "demographic_questions", "consent_or_signature",
] as const);

function availabilityForPreparation(job: PrepJob, now: Date): AvailabilityAssessment | null {
  const hasPostingAvailabilityEvidence = Boolean(
    job.description?.trim()
      || job.location?.trim()
      || job.workplaceType?.trim(),
  );
  return hasPostingAvailabilityEvidence ? assessAvailability({
    title: job.title,
    description: job.description ?? "",
    location: job.location,
    workplaceType: job.workplaceType,
  }, now) : null;
}

export function buildApplicationPreparation(input: {
  job: PrepJob;
  profileFields: ApplicationProfileField[];
  claims: PrepClaim[];
  relevantClaimIds?: string[];
  now?: Date;
}) {
  const channel = classifyApplicationUrl(input.job.canonicalUrl);
  const availability = availabilityForPreparation(input.job, input.now ?? new Date());
  const verified = new Map(input.profileFields
    .filter((field) => field.verified && field.kind !== "graduation_year")
    .map((field) => [field.kind, field.claim.trim()]));
  const verifiedProfileKeys = APPLICATION_PROFILE_KEYS.filter((key) => Boolean(verified.get(key)));
  const missingProfileKeys = REQUIRED_APPLICATION_PROFILE_KEYS.filter((key) => !verified.get(key));
  const blockers: string[] = [];
  if (!input.job.currentSnapshotId) blockers.push("Current immutable job snapshot is missing");
  for (const key of missingProfileKeys) blockers.push(`Missing verified profile field: ${key}`);
  if (channel.requiresOfficialResolution) blockers.push("Prefer the official company or ATS application URL before automation");
  if (channel.id === "unknown") blockers.push("Application portal is not recognized");
  if (availability?.lane === "hard_mismatch") {
    blockers.push(`Availability mismatch: ${availability.reasons[0]}`);
  } else if (availability?.lane === "break_only") {
    blockers.push("Availability: this role is break-window only under the current semester schedule; reconsider it in Dec–Jan or May–Jul");
  }

  const approved = selectUsableApprovedClaims(input.claims, {
    allowSyntheticDemo: input.job.id.startsWith("demo_job_"),
  });
  const requested = input.relevantClaimIds === undefined ? null : new Set(input.relevantClaimIds);
  const selected = (requested === null ? approved : approved.filter((claim) => requested.has(claim.id))).slice(0, 6);
  if (!selected.length) blockers.push("No approved resume claims are available for role-specific answers");

  const safeFields = Object.fromEntries(APPLICATION_PROFILE_KEYS.flatMap((key) => {
    const value = verified.get(key);
    return value ? [[key, value]] : [];
  })) as Record<string, string>;
  const profileBindings = buildApplicationProfileBindings(input.profileFields, safeFields);

  return {
    status: blockers.length ? "needs_input" as const : "ready_for_review" as const,
    blockers: [...new Set(blockers)],
    packet: {
      schemaVersion: 1,
      jobSnapshotId: input.job.currentSnapshotId,
      applicationUrl: input.job.canonicalUrl,
      channel,
      availability,
      availabilityReviewRequired: availability?.lane === "needs_verification",
      safeFields,
      profileBindings,
      requiredProfileKeys: [...REQUIRED_APPLICATION_PROFILE_KEYS],
      verifiedProfileKeys,
      missingProfileKeys,
      claimIds: selected.map((claim) => claim.id),
      claimStatements: selected.map((claim) => claim.statement),
      alwaysConfirmPerApplication: [...ALWAYS_CONFIRM_APPLICATION_FIELDS],
      externalSideEffect: false,
    },
  };
}
