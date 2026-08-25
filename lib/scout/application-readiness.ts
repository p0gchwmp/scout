import {
  APPLICATION_PROFILE_KEYS,
  ALWAYS_CONFIRM_APPLICATION_FIELDS,
  buildApplicationPreparation,
  REQUIRED_APPLICATION_PROFILE_KEYS,
  type ApplicationProfileField,
  type PrepClaim,
} from "./application-prep.ts";
import { evaluateResumeAlignment, type ResumeClaimText } from "./resume-alignment.ts";

export type ApplicationReadinessStatus = "ready" | "almost_ready" | "needs_setup" | "blocked";

export type ReadinessJob = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  canonicalUrl: string;
  currentSnapshotId: string | null;
};

export type ReadinessClaim = PrepClaim & Pick<ResumeClaimText, "evidence">;

const confirmationLabels: Record<(typeof ALWAYS_CONFIRM_APPLICATION_FIELDS)[number], string> = {
  work_authorization: "Work authorization",
  visa_or_sponsorship: "Visa / sponsorship",
  salary_or_compensation: "Salary / compensation",
  availability: "Availability / start date",
  demographic_questions: "Demographic / voluntary disclosure questions",
  consent_or_signature: "Consent / signature",
};

function humanizeKey(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function assessApplicationReadiness(input: {
  job: ReadinessJob;
  profileFields: ApplicationProfileField[];
  claims: ReadinessClaim[];
}) {
  const alignment = evaluateResumeAlignment(input.job, input.claims);
  const relevantClaimIds = [...new Set(alignment.supportingClaims.flatMap((support) => support.claimIds))];
  const prepared = buildApplicationPreparation({
    job: input.job,
    profileFields: input.profileFields,
    claims: input.claims,
    relevantClaimIds,
  });

  const verifiedKinds = new Set(input.profileFields.filter((field) => field.verified && field.claim.trim()).map((field) => field.kind));
  const verifiedRequiredKeys = REQUIRED_APPLICATION_PROFILE_KEYS.filter((key) => verifiedKinds.has(key));
  const missingRequiredKeys = REQUIRED_APPLICATION_PROFILE_KEYS.filter((key) => !verifiedKinds.has(key));
  const optionalVerifiedKeys = APPLICATION_PROFILE_KEYS.filter((key) => !REQUIRED_APPLICATION_PROFILE_KEYS.includes(key) && verifiedKinds.has(key));
  const channel = prepared.packet.channel;
  const criticalBlockers = prepared.blockers.filter((blocker) => (
    blocker.includes("immutable job snapshot")
    || blocker.includes("official company or ATS")
    || blocker.includes("portal is not recognized")
  ));

  let score = 0;
  if (input.job.currentSnapshotId) score += 20;
  score += channel.id === "unknown" ? 0 : channel.requiresOfficialResolution ? 5 : 20;
  score += Math.round((verifiedRequiredKeys.length / REQUIRED_APPLICATION_PROFILE_KEYS.length) * 35);
  score += relevantClaimIds.length ? 15 : 0;
  score += prepared.blockers.length === 0 ? 10 : Math.max(0, 10 - prepared.blockers.length * 2);
  if (criticalBlockers.length) score = Math.min(score, 49);
  score = Math.max(0, Math.min(100, score));

  const status: ApplicationReadinessStatus = prepared.status === "ready_for_review"
    ? "ready"
    : criticalBlockers.length
      ? "blocked"
      : prepared.blockers.length <= 2
        ? "almost_ready"
        : "needs_setup";

  const labels: Record<ApplicationReadinessStatus, string> = {
    ready: "Ready for Safe Fill",
    almost_ready: "Almost ready",
    needs_setup: "Needs profile setup",
    blocked: "Blocked before automation",
  };

  const nextActions: string[] = [];
  if (!input.job.currentSnapshotId) nextActions.push("Capture the official immutable job snapshot first");
  if (missingRequiredKeys.length) nextActions.push(`Verify ${missingRequiredKeys.length} required profile field${missingRequiredKeys.length === 1 ? "" : "s"}`);
  if (!relevantClaimIds.length) nextActions.push("Approve at least one role-relevant resume claim");
  if (channel.requiresOfficialResolution) nextActions.push("Resolve this lead to the official company or ATS application URL");
  if (channel.id === "unknown") nextActions.push("Review the application portal before using browser assistance");
  if (!nextActions.length) nextActions.push("Review the packet, then create a short-lived Safe Fill handoff");

  return {
    score,
    status,
    label: labels[status],
    preparationStatus: prepared.status,
    channel,
    blockers: prepared.blockers,
    criticalBlockers,
    verifiedRequiredKeys,
    missingRequiredKeys,
    optionalVerifiedKeys,
    requiredProfileCount: REQUIRED_APPLICATION_PROFILE_KEYS.length,
    supportingClaims: alignment.supportingClaims,
    claimIds: relevantClaimIds,
    alignment,
    manualConfirmations: ALWAYS_CONFIRM_APPLICATION_FIELDS.map((key) => confirmationLabels[key]),
    nextActions,
    profileSummary: `${verifiedRequiredKeys.length}/${REQUIRED_APPLICATION_PROFILE_KEYS.length} required profile fields verified`,
    missingProfileLabels: missingRequiredKeys.map(humanizeKey),
  };
}
