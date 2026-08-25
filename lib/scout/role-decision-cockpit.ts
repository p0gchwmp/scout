export const ROLE_DECISION_COCKPIT_CAPABILITIES = Object.freeze({
  separateDecisionAxes: true,
  singleCompositeScore: false,
  autoShortlist: false,
  autoReject: false,
  autoApply: false,
  autoSendOutreach: false,
  preserveEvidenceBoundaries: true,
} as const);

export type CockpitFitAxis = {
  score: number;
  label: string;
  gaps: string[];
  supportingClaimIds: string[];
};

export type CockpitQualityAxis = {
  score: number;
  label: string;
  tier: "strong_evidence" | "review" | "low_signal" | "red_flag";
  flags: Array<{ severity: "info" | "caution" | "high"; label: string }>;
};

export type CockpitPreferenceAxis = {
  points: number;
  label: string;
  signalCount: number;
};

export type CockpitReadinessAxis = {
  score: number;
  label: string;
  status: "ready" | "almost_ready" | "needs_setup" | "blocked";
  blockers: string[];
};

export type CockpitProgressAxis = {
  summary: string;
  externallySubmitted: boolean;
  nextAction: { kind: string; label: string; href: string };
};

export type CockpitFollowUpAxis = {
  bucket: "today" | "soon" | "waiting" | "done";
  label: string;
  reason: string;
  deadline: { label: string; raw: string } | null;
};

export type CockpitDecisionSummary = {
  headline: string;
  attention: string[];
  nextAction: { kind: string; label: string; href: string };
  boundary: string;
};

export function buildRoleDecisionSummary(input: {
  fit: CockpitFitAxis;
  quality: CockpitQualityAxis;
  preference: CockpitPreferenceAxis;
  readiness: CockpitReadinessAxis;
  progress: CockpitProgressAxis;
  followUp: CockpitFollowUpAxis;
}): CockpitDecisionSummary {
  const attention: string[] = [];

  if (input.quality.tier === "red_flag") {
    attention.push("Review the opportunity-quality red flags before investing more time.");
  } else if (input.quality.tier === "low_signal") {
    attention.push("Resolve the opportunity to stronger official evidence before relying on its details.");
  } else if (input.quality.tier === "review") {
    attention.push("Review the opportunity-quality cautions separately from resume fit.");
  }

  if (input.fit.gaps.length) attention.push(`Review ${input.fit.gaps.length} explicit fit/eligibility gap${input.fit.gaps.length === 1 ? "" : "s"}.`);
  if (!input.fit.supportingClaimIds.length) attention.push("No approved supporting claim is currently bound to this role fit.");
  if (input.readiness.status === "blocked" || input.readiness.status === "needs_setup") {
    attention.push(`${input.readiness.blockers.length || 1} application-readiness blocker${input.readiness.blockers.length === 1 ? "" : "s"} remain.`);
  }
  if (input.followUp.deadline) attention.push(input.followUp.deadline.label);

  let headline: string;
  if (input.followUp.bucket === "done") headline = "This opportunity is currently in a completed/inactive state.";
  else if (input.progress.externallySubmitted) headline = input.followUp.bucket === "waiting"
    ? "Application submitted externally; Scout is waiting without inventing a recruiter-response deadline."
    : "Application submitted externally; a review or follow-up decision now needs your attention.";
  else if (input.quality.tier === "red_flag") headline = "Pause on opportunity quality before moving deeper into the application.";
  else if (input.readiness.status === "ready") headline = "Application preparation is ready for your next reviewed step.";
  else headline = input.progress.summary;

  return {
    headline,
    attention: [...new Set(attention)],
    nextAction: input.progress.nextAction,
    boundary: "Fit, quality, preference, readiness and follow-up remain independent axes. Scout does not average them into a single decision score or act on the opportunity automatically.",
  };
}
