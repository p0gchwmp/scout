import { assessAvailability, type AvailabilityLane } from "./availability-eligibility.ts";
import { evaluateResumeAlignment, type ResumeAlignment, type ResumeClaimText } from "./resume-alignment.ts";
import { preferenceForFamily, type PreferenceCalibration } from "./preference-calibration.ts";
import { classifyRoleTaxonomy, type RoleFamilyId, type RolePreferenceLane, type RoleSectorTag } from "./role-taxonomy.ts";
import { assessTargetGeography, type TargetGeographyLane } from "./target-geography.ts";

export type ShortlistJob = {
  title: string;
  description: string;
  location: string;
  workplaceType?: string | null;
  postedAt?: string | null;
  lastSeenAt?: string | null;
  currentSnapshotId?: string | null;
  eligibilityRisks?: string[] | null;
};

export type ShortlistPriority = "high" | "review" | "consider" | "low" | "unranked";

export type ShortlistAssessment = {
  score: number;
  priority: ShortlistPriority;
  label: string;
  locationContext: "India" | "Remote" | "Global";
  locationTags: string[];
  targetGeographyLane: TargetGeographyLane;
  targetGeographyLabel: string;
  availabilityLane: AvailabilityLane;
  availabilityLabel: string;
  availabilityReasons: string[];
  availabilitySignals: string[];
  isBreakWindow: boolean;
  freshnessLabel: string;
  freshnessDays: number | null;
  roleFamilyId: RoleFamilyId;
  roleFamilyLabel: string;
  matchedRoleFamilies: string[];
  preferenceLane: RolePreferenceLane;
  preferenceLabel: string;
  learnedPreferencePoints: number;
  learnedPreferenceLabel: string;
  learnedPreferenceSignalCount: number;
  sectorTags: RoleSectorTag[];
  supportingClaimIds: string[];
  gaps: string[];
  reasons: string[];
  whyWorthYourTime: string;
  alignment: ResumeAlignment;
};

function daysSince(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

function freshness(job: ShortlistJob, now: Date) {
  const postedDays = daysSince(job.postedAt, now);
  if (postedDays !== null) {
    if (postedDays === 0) return { days: 0, label: "Posted today", points: 12 };
    if (postedDays === 1) return { days: 1, label: "Posted yesterday", points: 12 };
    if (postedDays <= 7) return { days: postedDays, label: `Posted ${postedDays} days ago`, points: 12 };
    if (postedDays <= 30) return { days: postedDays, label: `Posted ${postedDays} days ago`, points: 8 };
    if (postedDays <= 90) return { days: postedDays, label: `Posted ${postedDays} days ago`, points: 4 };
    return { days: postedDays, label: `Posted ${postedDays} days ago`, points: 0 };
  }

  const seenDays = daysSince(job.lastSeenAt, now);
  if (seenDays !== null && seenDays <= 7) {
    return { days: null, label: seenDays === 0 ? "Seen by Scout today" : `Seen by Scout ${seenDays} days ago`, points: 2 };
  }
  return { days: null, label: "Posting date unavailable", points: 0 };
}

function priorityFor(
  score: number,
  alignment: ResumeAlignment,
  geographyLane: TargetGeographyLane,
  availabilityLane: AvailabilityLane,
): Pick<ShortlistAssessment, "priority" | "label"> {
  if (alignment.band === "unranked") return { priority: "unranked", label: "Needs approved claims" };
  if (availabilityLane === "hard_mismatch") return { priority: "low", label: "Availability mismatch" };
  if (availabilityLane === "break_only") return { priority: "consider", label: "Break-window only" };
  if (geographyLane === "scoped_elsewhere") {
    if (score >= 40) return { priority: "consider", label: "Location review" };
    return { priority: "low", label: "Lower geography priority" };
  }
  if (availabilityLane === "needs_verification" && score >= 60) return { priority: "review", label: "Availability review" };
  if (score >= 80) return { priority: "high", label: "High priority" };
  if (score >= 60) return { priority: "review", label: "Worth reviewing" };
  if (score >= 40) return { priority: "consider", label: "Consider" };
  return { priority: "low", label: "Lower priority" };
}

export function evaluateShortlist(
  job: ShortlistJob,
  claims: ResumeClaimText[],
  now = new Date(),
  calibration?: PreferenceCalibration,
): ShortlistAssessment {
  const alignment = evaluateResumeAlignment(job, claims);
  const taxonomy = classifyRoleTaxonomy(job);
  const learnedPreference = preferenceForFamily(calibration, taxonomy.primaryFamily.id);
  const learnedPreferencePoints = learnedPreference?.adjustment ?? 0;
  const fresh = freshness(job, now);
  const geography = assessTargetGeography(job);
  const availability = assessAvailability(job, now);
  const locationContext: ShortlistAssessment["locationContext"] = geography.lane === "india"
    ? "India"
    : geography.tags.includes("Remote")
      ? "Remote"
      : "Global";
  const claimIds = [...new Set(alignment.supportingClaims.flatMap((support) => support.claimIds))].sort();
  const storedRisks = (job.eligibilityRisks ?? []).filter((risk) => risk && !/snapshot required/i.test(risk));
  const gaps = [...new Set([...alignment.gaps, ...storedRisks])];

  const base: Record<ResumeAlignment["band"], number> = {
    strong: 60,
    partial: 45,
    stretch: 25,
    unranked: 10,
  };
  const themePoints = Math.min(15, alignment.matches.length * 3);
  const gapPoints = gaps.length === 0 ? 8 : gaps.length === 1 ? 3 : 0;
  const snapshotPoints = job.currentSnapshotId ? 5 : 0;
  const lanePoints = taxonomy.preferenceLane === "software_stretch" ? -8 : 5;
  const score = Math.max(0, Math.min(100,
    base[alignment.band]
      + themePoints
      + gapPoints
      + snapshotPoints
      + fresh.points
      + lanePoints
      + geography.scoreAdjustment
      + availability.scoreAdjustment
      + learnedPreferencePoints,
  ));
  const priority = priorityFor(score, alignment, geography.lane, availability.lane);

  const reasons = [
    alignment.label,
    `Role family: ${taxonomy.primaryFamily.label}`,
    taxonomy.preferenceLabel,
    `Target geography: ${geography.label}${geography.scoreAdjustment ? ` (${geography.scoreAdjustment > 0 ? "+" : ""}${geography.scoreAdjustment})` : ""}`,
    `Availability: ${availability.label}${availability.scoreAdjustment ? ` (${availability.scoreAdjustment > 0 ? "+" : ""}${availability.scoreAdjustment})` : ""}`,
    ...availability.reasons,
    learnedPreferencePoints
      ? `Repeated explicit feedback adds ${learnedPreferencePoints > 0 ? "+" : ""}${learnedPreferencePoints} soft preference points`
      : learnedPreference?.signalCount
        ? learnedPreference.label
        : "No active learned preference nudge for this role family",
    alignment.matches.length ? `${alignment.matches.length} evidenced fit theme${alignment.matches.length === 1 ? "" : "s"}` : "No evidenced fit themes yet",
    claimIds.length ? `${claimIds.length} approved supporting claim${claimIds.length === 1 ? "" : "s"}` : "No approved supporting claims matched",
    gaps.length ? `${gaps.length} explicit gap${gaps.length === 1 ? "" : "s"} to review` : "No explicit evidence/eligibility gap detected by current rules",
    fresh.label,
    job.currentSnapshotId ? "Official immutable snapshot captured" : "Official snapshot still required",
    ...taxonomy.sectorTags.map((tag) => `${tag} sector context`),
    ...geography.tags.map((tag) => `${tag} context`),
    ...availability.signals,
  ];

  let whyWorthYourTime: string;
  if (alignment.band === "unranked") {
    whyWorthYourTime = "Approve candidate claims first so Scout can judge this role against evidence instead of guessing.";
  } else if (availability.lane === "hard_mismatch") {
    whyWorthYourTime = "The resume fit may be real, but this role conflicts with the owner-approved availability policy, so Scout keeps it below currently feasible opportunities.";
  } else if (availability.lane === "break_only") {
    whyWorthYourTime = "This role may be worth revisiting for the Dec–Jan or May–Jul break windows, but it is not treated as semester-feasible.";
  } else if (taxonomy.preferenceLane === "software_stretch") {
    whyWorthYourTime = priority.priority === "high" || priority.priority === "review"
      ? "This is primarily software development, so Scout keeps it in the stretch lane; the approved evidence overlap is still strong enough to justify a deliberate look."
      : "This is primarily software development, so Scout keeps it visible in the stretch lane but behind equally supported analyst, product, operations, research, finance and technical-systems roles.";
  } else if (priority.priority === "high") {
    whyWorthYourTime = `Strong evidence overlap${fresh.days !== null && fresh.days <= 30 ? " on a recent posting" : ""}; this deserves an early review.`;
  } else if (priority.priority === "review") {
    whyWorthYourTime = gaps.length
      ? "There is meaningful evidence overlap, but review the stated gap before investing in an application."
      : "There is enough evidence overlap to justify a closer look before you decide.";
  } else if (priority.priority === "consider") {
    whyWorthYourTime = gaps.length
      ? "This could be viable, but the current evidence is mixed and the gaps need a deliberate check."
      : "The role has some support, but it is not yet one of Scout's strongest evidence-backed matches.";
  } else {
    whyWorthYourTime = "Keep this behind stronger matches unless the company or role is unusually interesting to you.";
  }
  if (availability.lane === "needs_verification") {
    whyWorthYourTime += " The posting does not state enough schedule/duration detail to confirm semester or break-window feasibility, so verify availability before preparing an application.";
  }
  if (geography.lane === "scoped_elsewhere") {
    whyWorthYourTime += " Scout downranks it because the posting is location-scoped outside explicit India; this is a target-geography preference, not a work-authorization conclusion.";
  } else if (geography.lane === "open_remote") {
    whyWorthYourTime += " The posting appears openly remote from the persisted location evidence, which fits Scout's India/remote target lane.";
  }
  if (learnedPreferencePoints) {
    whyWorthYourTime += ` Your repeated Shortlist/Reject feedback currently applies a small ${learnedPreferencePoints > 0 ? "+" : ""}${learnedPreferencePoints}-point preference nudge; evidence and eligibility still control the decision.`;
  }

  return {
    score,
    priority: priority.priority,
    label: priority.label,
    locationContext,
    locationTags: geography.tags,
    targetGeographyLane: geography.lane,
    targetGeographyLabel: geography.label,
    availabilityLane: availability.lane,
    availabilityLabel: availability.label,
    availabilityReasons: availability.reasons,
    availabilitySignals: availability.signals,
    isBreakWindow: availability.isBreakWindow,
    freshnessLabel: fresh.label,
    freshnessDays: fresh.days,
    roleFamilyId: taxonomy.primaryFamily.id,
    roleFamilyLabel: taxonomy.primaryFamily.label,
    matchedRoleFamilies: taxonomy.matchedFamilies.map((family) => family.label),
    preferenceLane: taxonomy.preferenceLane,
    preferenceLabel: taxonomy.preferenceLabel,
    learnedPreferencePoints,
    learnedPreferenceLabel: learnedPreference?.label ?? "No learned preference signal",
    learnedPreferenceSignalCount: learnedPreference?.signalCount ?? 0,
    sectorTags: taxonomy.sectorTags,
    supportingClaimIds: claimIds,
    gaps,
    reasons,
    whyWorthYourTime,
    alignment,
  };
}
