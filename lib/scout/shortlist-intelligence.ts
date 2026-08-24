import { evaluateResumeAlignment, type ResumeAlignment, type ResumeClaimText } from "./resume-alignment.ts";

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
  freshnessLabel: string;
  freshnessDays: number | null;
  supportingClaimIds: string[];
  gaps: string[];
  reasons: string[];
  whyWorthYourTime: string;
  alignment: ResumeAlignment;
};

const INDIA_PATTERN = /\b(india|bharat|bengaluru|bangalore|chennai|hyderabad|noida|gurugram|gurgaon|mumbai|delhi|new delhi|pune|kolkata|jammu|ahmedabad|jaipur|kochi|cochin|thiruvananthapuram|trivandrum|chandigarh|mohali|bhubaneswar|indore|lucknow|gurugram|goa)\b/i;
const REMOTE_PATTERN = /\b(remote|work from home|wfh|distributed)\b/i;

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

function locationContext(job: ShortlistJob) {
  const text = `${job.location ?? ""} ${job.workplaceType ?? ""}`;
  const india = INDIA_PATTERN.test(text);
  const remote = String(job.workplaceType ?? "").toLowerCase() === "remote" || REMOTE_PATTERN.test(text);
  const tags = [india ? "India" : null, remote ? "Remote" : null].filter((item): item is string => Boolean(item));
  if (!tags.length) tags.push("Global / other location");
  return {
    context: india ? "India" as const : remote ? "Remote" as const : "Global" as const,
    tags,
  };
}

function priorityFor(score: number, alignment: ResumeAlignment): Pick<ShortlistAssessment, "priority" | "label"> {
  if (alignment.band === "unranked") return { priority: "unranked", label: "Needs approved claims" };
  if (score >= 80) return { priority: "high", label: "High priority" };
  if (score >= 60) return { priority: "review", label: "Worth reviewing" };
  if (score >= 40) return { priority: "consider", label: "Consider" };
  return { priority: "low", label: "Lower priority" };
}

export function evaluateShortlist(job: ShortlistJob, claims: ResumeClaimText[], now = new Date()): ShortlistAssessment {
  const alignment = evaluateResumeAlignment(job, claims);
  const fresh = freshness(job, now);
  const place = locationContext(job);
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
  const score = Math.min(100, base[alignment.band] + themePoints + gapPoints + snapshotPoints + fresh.points);
  const priority = priorityFor(score, alignment);

  const reasons = [
    alignment.label,
    alignment.matches.length ? `${alignment.matches.length} evidenced fit theme${alignment.matches.length === 1 ? "" : "s"}` : "No evidenced fit themes yet",
    claimIds.length ? `${claimIds.length} approved supporting claim${claimIds.length === 1 ? "" : "s"}` : "No approved supporting claims matched",
    gaps.length ? `${gaps.length} explicit gap${gaps.length === 1 ? "" : "s"} to review` : "No explicit eligibility gap detected by current rules",
    fresh.label,
    job.currentSnapshotId ? "Official immutable snapshot captured" : "Official snapshot still required",
    ...place.tags.map((tag) => `${tag} context`),
  ];

  let whyWorthYourTime: string;
  if (alignment.band === "unranked") {
    whyWorthYourTime = "Approve candidate claims first so Scout can judge this role against evidence instead of guessing.";
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

  return {
    score,
    priority: priority.priority,
    label: priority.label,
    locationContext: place.context,
    locationTags: place.tags,
    freshnessLabel: fresh.label,
    freshnessDays: fresh.days,
    supportingClaimIds: claimIds,
    gaps,
    reasons,
    whyWorthYourTime,
    alignment,
  };
}
