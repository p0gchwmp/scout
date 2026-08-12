import type { CandidateProfile, NormalizedJob } from "./types";

export type RankedJob = NormalizedJob & { score: number; reasons: string[]; risks: string[] };

const includesAny = (text: string, values: string[]) => values.some((value) => text.includes(value.toLowerCase()));

export function rankJob(job: NormalizedJob, profile: CandidateProfile, now = new Date()): RankedJob {
  const haystack = `${job.title} ${job.description}`.toLowerCase();
  const location = job.location.toLowerCase();
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 25;

  if (includesAny(haystack, profile.roleKeywords)) { score += 24; reasons.push("Role family match"); }
  const matchedSkills = profile.verifiedSkills.filter((skill) => haystack.includes(skill.toLowerCase()));
  if (matchedSkills.length) { score += Math.min(18, matchedSkills.length * 6); reasons.push(`${matchedSkills.length} evidenced skill${matchedSkills.length > 1 ? "s" : ""} match`); }
  if (/intern|student|undergraduate/.test(haystack) && profile.currentStudent) { score += 16; reasons.push("Student-friendly"); }
  if (location.includes("india") || profile.preferredLocations.some((item) => location.includes(item.toLowerCase()))) { score += 12; reasons.push("Preferred location"); }
  else if (job.workplaceType === "remote" && profile.remoteAllowed) { score += 10; reasons.push("Remote compatible"); }
  else { risks.push("Location or work authorization needs confirmation"); }
  if (job.postedAt) {
    const ageDays = Math.max(0, (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000);
    if (ageDays <= 3) { score += 5; reasons.push("Fresh posting"); }
    else if (ageDays > 21) score -= 8;
  }
  if (/\b([3-9]|10)\+? years?\b/i.test(job.description)) { score -= 24; risks.push("Experience requirement may be incompatible"); }
  return { ...job, score: Math.max(0, Math.min(100, score)), reasons, risks };
}

export function isEligibleForDailyQueue(job: RankedJob) {
  return job.score >= 70 && !job.risks.some((risk) => risk.includes("Experience requirement"));
}
