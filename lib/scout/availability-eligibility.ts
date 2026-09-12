export const OWNER_AVAILABILITY_POLICY = Object.freeze({
  semesterMode: "part_time_flexible_only",
  breakMonthsUtc: [0, 4, 5, 6, 11] as const,
  fullTimeDuringBreaks: true,
  sixMonthOnsiteAllowed: false,
  unknownScheduleRequiresVerification: true,
} as const);

export type AvailabilityLane = "compatible_now" | "break_only" | "hard_mismatch" | "needs_verification";

export type AvailabilityJob = {
  title: string;
  description: string;
  location?: string | null;
  workplaceType?: string | null;
};

export type AvailabilityAssessment = {
  lane: AvailabilityLane;
  label: string;
  isBreakWindow: boolean;
  scoreAdjustment: number;
  sortWeight: number;
  reasons: string[];
  signals: string[];
};

const SIX_MONTH = /\b(?:6|six)[ -]?months?\b|\b(?:6|six)[ -]?month\b/i;
const FULL_TIME = /\bfull[ -]?time\b|\b(?:at least\s+)?(?:6|7|8|9)\s*(?:hours?|hrs?)\s*(?:per|a)\s*day\b|\b(?:35|40)\+?\s*(?:hours?|hrs?)\s*(?:per|a)\s*week\b|\b(?:monday|mon)\s*(?:-|to|through)\s*(?:friday|fri)\b|\b(?:5|five)\s+days?\s+(?:per|a)\s+week\b/i;
const PART_TIME = /\bpart[ -]?time\b|\bflexible (?:hours?|schedule)\b|\b(?:10|12|15|20|24|25)\s*(?:hours?|hrs?)\s*(?:per|a)\s*week\b/i;
const ONSITE_TEXT = /\b(?:fully\s+)?on[ -]?site\b|\bin[ -]?office\b|\bwork from office\b/i;
const HYBRID_TEXT = /\bhybrid\b/i;

function normalized(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isOwnerBreakWindow(now = new Date()) {
  return OWNER_AVAILABILITY_POLICY.breakMonthsUtc.includes(now.getUTCMonth() as (typeof OWNER_AVAILABILITY_POLICY.breakMonthsUtc)[number]);
}

export function assessAvailability(job: AvailabilityJob, now = new Date()): AvailabilityAssessment {
  const title = normalized(job.title);
  const description = normalized(job.description);
  const location = normalized(job.location);
  const workplaceType = normalized(job.workplaceType).toLowerCase();
  const text = `${title} ${description} ${location}`;
  const isBreakWindow = isOwnerBreakWindow(now);
  const sixMonth = SIX_MONTH.test(text);
  const fullTime = FULL_TIME.test(text);
  const partTime = PART_TIME.test(text);
  const onsite = workplaceType === "on-site" || workplaceType === "onsite" || ONSITE_TEXT.test(text);
  const hybrid = workplaceType === "hybrid" || HYBRID_TEXT.test(text);
  const remote = workplaceType === "remote" || /\bremote\b/i.test(text);

  const signals = [
    sixMonth ? "Six-month duration stated" : "",
    fullTime ? "Full-time or 6+ hours/day schedule stated" : "",
    partTime ? "Part-time/flexible schedule stated" : "",
    onsite ? "On-site requirement stated" : "",
    hybrid ? "Hybrid attendance stated" : "",
    remote ? "Remote work stated" : "",
  ].filter(Boolean);

  if (sixMonth && (onsite || hybrid) && !OWNER_AVAILABILITY_POLICY.sixMonthOnsiteAllowed) {
    return {
      lane: "hard_mismatch",
      label: "Availability mismatch",
      isBreakWindow,
      scoreAdjustment: -35,
      sortWeight: 0,
      reasons: ["Six-month on-site/hybrid commitments are outside the owner-approved availability policy."],
      signals,
    };
  }

  if (isBreakWindow) {
    if (partTime || fullTime || onsite || hybrid || remote) {
      return {
        lane: "compatible_now",
        label: "Break-window compatible",
        isBreakWindow,
        scoreAdjustment: 8,
        sortWeight: 3,
        reasons: ["Full-time internships are allowed during the Dec–Jan and May–Jul break windows."],
        signals,
      };
    }
    return {
      lane: "needs_verification",
      label: "Availability needs verification",
      isBreakWindow,
      scoreAdjustment: -4,
      sortWeight: 1,
      reasons: ["The posting does not clearly state enough schedule or duration information to verify break-window compatibility."],
      signals,
    };
  }

  if ((onsite || hybrid) || fullTime) {
    return {
      lane: "break_only",
      label: "Break-window only",
      isBreakWindow,
      scoreAdjustment: -12,
      sortWeight: 1,
      reasons: ["During semester, Scout treats full-time, 6+ hours/day, on-site and hybrid internships as unavailable; they can be reconsidered for Dec–Jan or May–Jul breaks."],
      signals,
    };
  }

  if (partTime && !onsite && !hybrid) {
    return {
      lane: "compatible_now",
      label: "Semester-compatible",
      isBreakWindow,
      scoreAdjustment: 10,
      sortWeight: 3,
      reasons: ["The posting explicitly indicates part-time/flexible work without an on-site attendance requirement, matching the semester availability policy."],
      signals,
    };
  }

  return {
    lane: "needs_verification",
    label: "Availability needs verification",
    isBreakWindow,
    scoreAdjustment: -5,
    sortWeight: 2,
    reasons: ["During semester, only part-time/flexible roles are assumed feasible. This posting does not state enough schedule information to confirm that."],
    signals,
  };
}
