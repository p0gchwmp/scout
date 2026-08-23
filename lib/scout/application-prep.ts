import { classifyApplicationUrl } from "./application-sites.ts";

export const APPLICATION_PREP_CAPABILITIES = Object.freeze({ prepare: true, submit: false, browserMutation: false } as const);

export const APPLICATION_PROFILE_KEYS = [
  "full_name", "email", "phone", "current_location", "university", "program", "graduation_year",
  "linkedin_url", "github_url", "portfolio_url", "resume_reference",
] as const;

export type ApplicationProfileKey = (typeof APPLICATION_PROFILE_KEYS)[number];
export type ApplicationProfileField = { id: string; kind: string; claim: string; evidence: string; verified: boolean; updatedAt?: string };
export type PrepJob = { id: string; company: string; title: string; canonicalUrl: string; currentSnapshotId: string | null };
export type PrepClaim = { id: string; statement: string; status: "draft" | "approved" | "rejected" };

const requiredKeys: ApplicationProfileKey[] = ["full_name", "email", "current_location", "university", "program", "graduation_year", "resume_reference"];

export function buildApplicationPreparation(input: {
  job: PrepJob;
  profileFields: ApplicationProfileField[];
  claims: PrepClaim[];
  relevantClaimIds?: string[];
}) {
  const channel = classifyApplicationUrl(input.job.canonicalUrl);
  const verified = new Map(input.profileFields.filter((field) => field.verified).map((field) => [field.kind, field.claim.trim()]));
  const blockers: string[] = [];
  if (!input.job.currentSnapshotId) blockers.push("Current immutable job snapshot is missing");
  for (const key of requiredKeys) if (!verified.get(key)) blockers.push(`Missing verified profile field: ${key}`);
  if (channel.id === "linkedin" || channel.id === "indeed" || channel.id === "naukri") blockers.push("Prefer the official company or ATS application URL before automation");
  if (channel.id === "unknown") blockers.push("Application portal is not recognized");

  const approved = input.claims.filter((claim) => claim.status === "approved");
  const requested = new Set(input.relevantClaimIds ?? []);
  const selected = (requested.size ? approved.filter((claim) => requested.has(claim.id)) : approved).slice(0, 6);
  if (!selected.length) blockers.push("No approved resume claims are available for role-specific answers");

  const safeFields = Object.fromEntries(APPLICATION_PROFILE_KEYS.flatMap((key) => {
    const value = verified.get(key);
    return value ? [[key, value]] : [];
  }));

  return {
    status: blockers.length ? "needs_input" as const : "ready_for_review" as const,
    blockers: [...new Set(blockers)],
    packet: {
      schemaVersion: 1,
      jobSnapshotId: input.job.currentSnapshotId,
      applicationUrl: input.job.canonicalUrl,
      channel,
      safeFields,
      claimIds: selected.map((claim) => claim.id),
      claimStatements: selected.map((claim) => claim.statement),
      alwaysConfirmPerApplication: ["work_authorization", "visa_or_sponsorship", "salary_or_compensation", "availability", "demographic_questions", "consent_or_signature"],
      externalSideEffect: false,
    },
  };
}
