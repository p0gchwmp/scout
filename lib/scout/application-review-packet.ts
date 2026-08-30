import type { OpportunityFitAssessment } from "./opportunity-fit.ts";
import type { OpportunityQualityAssessment } from "./opportunity-quality-intelligence.ts";
import type { ResumeAlignment } from "./resume-alignment.ts";

export const APPLICATION_REVIEW_PACKET_CAPABILITIES = Object.freeze({
  persistedSnapshotEvidenceOnly: true,
  approvedClaimsOnly: true,
  exactEvidenceExcerpts: true,
  humanReviewRequired: true,
  autoRejectOpportunity: false,
  autoApply: false,
  submitApplication: false,
  sendOutreach: false,
} as const);

export type ReviewPacketClaim = {
  id: string;
  statement: string;
  evidence: string;
  status: "draft" | "approved" | "rejected";
};

export type ReviewPacketContact = {
  id: string;
  jobSnapshotId: string;
  reviewState: "needs_review" | "accepted" | "rejected";
};

export type ReviewPacketSnapshot = {
  id: string;
  canonicalUrl: string;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: string;
  postedAt: string | null;
  eligibilityRisks: string[];
};

export type ReviewPacketReadiness = {
  status: "ready" | "almost_ready" | "needs_setup" | "blocked";
  label: string;
  blockers: string[];
  criticalBlockers: string[];
  claimIds: string[];
  profileSummary: string;
  manualConfirmations: string[];
  alignment: ResumeAlignment;
};

export type ApplicationReviewState = "review_ready" | "needs_input" | "hold_for_human_review";
export type OutreachReviewState = "contact_accepted" | "needs_contact_review" | "no_public_contact" | "blocked_without_snapshot";

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function applicationReviewState(input: {
  snapshot: ReviewPacketSnapshot;
  quality: OpportunityQualityAssessment;
  fit: OpportunityFitAssessment;
  readiness: ReviewPacketReadiness;
}) {
  const reasons: string[] = [];
  const highRisk = input.quality.flags.filter((flag) => flag.severity === "high");
  if (input.fit.eligibility === "mismatch") reasons.push(...input.fit.eligibilityReasons);
  if (input.fit.priority === "parked") reasons.push(...input.fit.priorityReasons);
  if (highRisk.length) reasons.push(...highRisk.map((flag) => `${flag.label}: ${flag.evidence}`));
  if (reasons.length) {
    return { state: "hold_for_human_review" as const, reasons: unique(reasons) };
  }
  if (input.readiness.status !== "ready") {
    return {
      state: "needs_input" as const,
      reasons: unique(input.readiness.blockers.length ? input.readiness.blockers : [input.readiness.label]),
    };
  }
  return {
    state: "review_ready" as const,
    reasons: ["Current immutable job evidence, reusable profile evidence, and approved role claims are ready for human application review."],
  };
}

function outreachReviewState(snapshotId: string, contacts: ReviewPacketContact[]) {
  const current = contacts.filter((contact) => contact.jobSnapshotId === snapshotId);
  const accepted = current.filter((contact) => contact.reviewState === "accepted");
  const needsReview = current.filter((contact) => contact.reviewState === "needs_review");
  if (accepted.length) {
    return {
      state: "contact_accepted" as const,
      reasons: ["At least one public contact evidence record for this exact job snapshot was explicitly accepted for review-bound outreach drafting."],
      acceptedContactIds: accepted.map((contact) => contact.id),
      needsReviewContactIds: needsReview.map((contact) => contact.id),
    };
  }
  if (needsReview.length) {
    return {
      state: "needs_contact_review" as const,
      reasons: ["Public contact evidence exists for this exact job snapshot, but none has been accepted yet."],
      acceptedContactIds: [],
      needsReviewContactIds: needsReview.map((contact) => contact.id),
    };
  }
  return {
    state: "no_public_contact" as const,
    reasons: ["No accepted or reviewable public contact evidence is pinned to this exact job snapshot."],
    acceptedContactIds: [],
    needsReviewContactIds: [],
  };
}

export function buildApplicationReviewPacket(input: {
  snapshot: ReviewPacketSnapshot;
  quality: OpportunityQualityAssessment;
  fit: OpportunityFitAssessment;
  readiness: ReviewPacketReadiness;
  claims: ReviewPacketClaim[];
  contacts?: ReviewPacketContact[];
  generatedAt?: string;
}) {
  if (!input.snapshot.id.trim()) throw new Error("An immutable job snapshot id is required for an application review packet");
  const claimIdSet = new Set(input.readiness.claimIds);
  const claimBindings = input.claims
    .filter((claim) => claim.status === "approved" && claimIdSet.has(claim.id) && claim.statement.trim() && claim.evidence.trim())
    .map((claim) => ({ id: claim.id, statement: claim.statement.trim(), evidence: claim.evidence.trim() }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const allowedClaimIds = new Set(claimBindings.map((claim) => claim.id));
  const supportingClaims = input.readiness.alignment.supportingClaims.flatMap((support) => {
    const claimIds = support.claimIds.filter((claimId) => allowedClaimIds.has(claimId));
    return claimIds.length ? [{ theme: support.theme, label: support.label, claimIds }] : [];
  });

  const application = applicationReviewState({
    snapshot: input.snapshot,
    quality: input.quality,
    fit: input.fit,
    readiness: input.readiness,
  });
  const outreach = outreachReviewState(input.snapshot.id, input.contacts ?? []);

  return {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    jobSnapshotId: input.snapshot.id,
    officialEvidence: {
      canonicalUrl: input.snapshot.canonicalUrl,
      company: input.snapshot.company,
      title: input.snapshot.title,
      location: input.snapshot.location,
      workplaceType: input.snapshot.workplaceType,
      postedAt: input.snapshot.postedAt,
      quality: {
        score: input.quality.score,
        tier: input.quality.tier,
        label: input.quality.label,
        provider: input.quality.provider,
        registeredSource: input.quality.registeredSource,
        companyDomain: input.quality.companyDomain,
        compensation: input.quality.compensation,
        duration: input.quality.duration,
        arrangement: input.quality.arrangement,
        arrangementEvidence: input.quality.arrangementEvidence,
        flags: input.quality.flags,
      },
    },
    schedulingAndEligibility: {
      priority: input.fit.priority,
      priorityLabel: input.fit.priorityLabel,
      priorityReasons: input.fit.priorityReasons,
      timingLane: input.fit.timingLane,
      summer2027: input.fit.summer2027,
      summerReason: input.fit.summerReason,
      collegeCompatibility: input.fit.collegeCompatibility,
      collegeReason: input.fit.collegeReason,
      roleFit: input.fit.roleFit,
      roleReason: input.fit.roleReason,
      eligibility: input.fit.eligibility,
      eligibilityReasons: input.fit.eligibilityReasons,
      persistedEligibilityRisks: unique(input.snapshot.eligibilityRisks),
      duration: input.fit.duration,
      hoursPerWeek: input.fit.hoursPerWeek,
      dateWindow: input.fit.dateWindow,
      freshness: input.fit.freshness,
      exactEvidence: input.fit.evidence,
      unknowns: input.fit.unknowns,
    },
    resumeEvidence: {
      band: input.readiness.alignment.band,
      label: input.readiness.alignment.label,
      matches: input.readiness.alignment.matches,
      gaps: input.readiness.alignment.gaps,
      eligibilityGaps: input.readiness.alignment.eligibilityGaps,
      supportingClaims,
      claimBindings,
      notChecked: input.readiness.alignment.notChecked,
      caveats: input.readiness.alignment.caveats,
    },
    applicationReview: {
      ...application,
      readinessStatus: input.readiness.status,
      readinessLabel: input.readiness.label,
      profileSummary: input.readiness.profileSummary,
      blockers: input.readiness.blockers,
      criticalBlockers: input.readiness.criticalBlockers,
      humanReviewRequired: true as const,
      safeFillMayBeOfferedAfterPacketChecks: application.state === "review_ready",
    },
    outreachReview: {
      ...outreach,
      humanReviewRequired: true as const,
      draftMayBePreparedForReview: outreach.state === "contact_accepted",
      sendAvailable: false as const,
    },
    manualConfirmations: input.readiness.manualConfirmations,
    safety: {
      autoRejectOpportunity: false as const,
      autoApply: false as const,
      submitApplication: false as const,
      sendOutreach: false as const,
    },
  };
}

export function applicationPacketSnapshotId(packet: unknown) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return null;
  const value = (packet as Record<string, unknown>).jobSnapshotId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function applicationPacketMatchesCurrentSnapshot(packet: unknown, currentSnapshotId: string | null | undefined) {
  const current = currentSnapshotId?.trim() ?? "";
  return Boolean(current && applicationPacketSnapshotId(packet) === current);
}
