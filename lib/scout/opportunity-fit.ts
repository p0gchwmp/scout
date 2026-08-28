import type { OpportunityQualityAssessment, OpportunityQualityJob } from "./opportunity-quality-intelligence.ts";

export const OPPORTUNITY_FIT_CAPABILITIES = Object.freeze({
  persistedPostingEvidenceOnly: true,
  deterministicClassification: true,
  exactEvidenceExcerpts: true,
  remoteAloneImpliesCollegeCompatibility: false,
  missingEvidenceMeansMismatch: false,
  summer2027WindowFixed: true,
  resumeClaimsModified: false,
  autoRejectOpportunity: false,
  sendEmail: false,
  submitApplication: false,
} as const);

export type TimingLane = "college_compatible_now" | "summer_2027" | "future" | "unknown";
export type FitStatus = "compatible" | "unknown" | "mismatch";
export type Summer2027Fit = "exact" | "compatible" | "unknown" | "mismatch";
export type RoleFit = "strong" | "adjacent" | "stretch" | "unknown";
export type FreshnessFit = "fresh" | "recent" | "aging" | "stale" | "unknown";
export type OpportunityPriority = "A" | "B" | "C" | "parked";

export type FitEvidence = {
  code: string;
  label: string;
  excerpt: string;
};

export type OpportunityFitAssessment = {
  priority: OpportunityPriority;
  priorityLabel: string;
  priorityReasons: string[];
  timingLane: TimingLane;
  summer2027: Summer2027Fit;
  summerReason: string;
  collegeCompatibility: FitStatus;
  collegeReason: string;
  roleFit: RoleFit;
  roleReason: string;
  eligibility: FitStatus;
  eligibilityReasons: string[];
  duration: { text: string | null; weeks: number | null; evidence: string | null };
  hoursPerWeek: { min: number | null; max: number | null; evidence: string | null };
  dateWindow: { start: string | null; end: string | null; evidence: string | null };
  freshness: { status: FreshnessFit; daysOld: number | null };
  evidence: FitEvidence[];
  unknowns: string[];
};

const SUMMER_START = Date.UTC(2027, 4, 21, 0, 0, 0, 0);
const SUMMER_END = Date.UTC(2027, 6, 31, 23, 59, 59, 999);
const DAY_MS = 86_400_000;
const CANDIDATE_GRAD_YEARS = new Set([2028, 2029]);

const EARLY_CAREER_PATTERN = /\b(?:intern|internship|trainee|apprentice|co[- ]?op|graduate|new grad|entry[- ]?level|fresher|student|junior)\b/i;
const SENIOR_PATTERN = /\b(?:senior|staff|principal|director|head of|vice president|vp|general manager|engineering manager|product manager|program manager|project manager|team lead)\b/i;
const STRONG_ROLE_PATTERN = /\b(?:product(?:\s+(?:management|operations|strategy|analyst))?|business(?:\s+(?:analyst|operations|strategy))?|strategy|operations|finance|financial|economics?|analytics?|data analyst|research|public policy|policy|health[- ]?tech|healthcare)\b/i;
const ADJACENT_ROLE_PATTERN = /\b(?:growth|marketing|customer success|implementation|solutions|partnerships?|consulting|founder'?s office|generalist|program|project|commercial|sales operations)\b/i;
const STRETCH_ROLE_PATTERN = /\b(?:software (?:engineer|developer)|frontend|front[- ]end|backend|back[- ]end|full[- ]stack|fullstack|devops|site reliability|sre|machine learning engineer|ml engineer|data engineer|qa engineer|quality assurance engineer)\b/i;

const PART_TIME_PATTERN = /\bpart[- ]time\b/i;
const FLEXIBLE_PATTERN = /\b(?:flexible hours?|flexible schedule|asynchronous|async work|choose your hours?|work around (?:your )?classes|student[- ]friendly schedule)\b/i;
const FULL_TIME_PATTERN = /\bfull[- ]time\b/i;
const HOURS_PATTERN = /\b(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:hours?|hrs?)\s*(?:per|a|\/)\s*week\b/i;
const FIXED_US_HOURS_PATTERN = /\b(?:(?:must|required to|requires? you to)\s+(?:work|be available).{0,55}(?:US|U\.S\.|Eastern|Pacific|EST|EDT|ET|PST|PDT|PT).{0,25}(?:business|working)?\s*hours|9\s*(?:am|a\.m\.)\s*(?:-|–|to)\s*5\s*(?:pm|p\.m\.).{0,30}(?:EST|EDT|ET|PST|PDT|PT|Eastern|Pacific))\b/i;
const SUMMER_2027_PATTERN = /\bsummer\s+2027\b/i;
const FUTURE_PATTERN = /\b(?:summer|winter|spring|fall|autumn)\s+(2028|2029|2030)\b/i;
const MBA_REQUIRED_PATTERN = /\b(?:mba|master'?s degree|graduate degree|postgraduate degree)\b.{0,50}\b(?:required|mandatory|must have|minimum qualification)\b/i;
const EXPERIENCE_PATTERN = /\b(?:minimum(?:\s+of)?\s+)?(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:professional\s+|work\s+|industry\s+|relevant\s+)?experience\b/i;
const ENROLLED_PATTERN = /\b(?:currently enrolled|currently pursuing|pursuing (?:a )?bachelor'?s|undergraduate student|college student)\b/i;
const GRAD_YEAR_PATTERN = /\b(?:graduating|graduation(?:\s+year)?|expected graduation).{0,35}?(20\d{2})(?:\s*(?:-|–|to|through|or)\s*(20\d{2}))?/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const DURATION_PATTERNS = [
  /\b(?:internship|program(?:me)?|role)\s+(?:duration\s*[-:]?\s*|(?:runs?|lasts?|is)\s+(?:for\s+)?)(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]?(weeks?|months?)\b/i,
  /\bduration\s*[-:]?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]?(weeks?|months?)\b/i,
  /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]?(weeks?|months?)[- ]+(?:internship|program(?:me)?|placement)\b/i,
] as const;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const FULL_DATE_RANGE = new RegExp(`\\b(?:from\\s+)?((${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+20\\d{2})\\s*(?:to|through|until|-|–|—)\\s*((${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+20\\d{2})`, "i");
const SHARED_YEAR_DATE_RANGE = new RegExp(`\\b(?:from\\s+)?((${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?)\\s*(?:to|through|until|-|–|—)\\s*((${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?)(?:,)?\\s+(20\\d{2})`, "i");

function cleanText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function excerptAround(text: string, match: RegExpMatchArray | null, radius = 80) {
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end).trim().slice(0, 320);
}

function normalizedNumber(raw: string) {
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS[raw.toLowerCase()] ?? null;
}

function durationFrom(text: string) {
  for (const pattern of DURATION_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = normalizedNumber(match[1]);
    if (count === null) return { text: match[0].trim(), weeks: null, evidence: excerptAround(text, match) };
    const unit = match[2].toLowerCase();
    const weeks = unit.startsWith("month") ? Math.round(count * 4.345 * 10) / 10 : count;
    return { text: `${count} ${unit}`, weeks, evidence: excerptAround(text, match) };
  }
  return { text: null, weeks: null, evidence: null };
}

function hoursFrom(text: string) {
  const match = text.match(HOURS_PATTERN);
  if (!match) return { min: null, max: null, evidence: null };
  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : first;
  return { min: Math.min(first, second), max: Math.max(first, second), evidence: excerptAround(text, match) };
}

function parseDateToken(value: string) {
  const cleaned = value.replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const timestamp = Date.parse(`${cleaned} 00:00:00 UTC`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateWindowFrom(text: string) {
  const full = text.match(FULL_DATE_RANGE);
  if (full) {
    const start = parseDateToken(full[1]);
    const end = parseDateToken(full[3]);
    if (start !== null && end !== null && end >= start) {
      return { start, end, evidence: excerptAround(text, full) };
    }
  }
  const shared = text.match(SHARED_YEAR_DATE_RANGE);
  if (shared) {
    const year = shared[5];
    const start = parseDateToken(`${shared[1]} ${year}`);
    const end = parseDateToken(`${shared[3]} ${year}`);
    if (start !== null && end !== null && end >= start) {
      return { start, end, evidence: excerptAround(text, shared) };
    }
  }
  return { start: null, end: null, evidence: null };
}

function isoDay(timestamp: number | null) {
  return timestamp === null ? null : new Date(timestamp).toISOString().slice(0, 10);
}

function roleFitFrom(title: string) {
  if (STRETCH_ROLE_PATTERN.test(title)) return { fit: "stretch" as const, reason: "Role is primarily a software/engineering lane outside Scout's core search priorities" };
  if (STRONG_ROLE_PATTERN.test(title)) return { fit: "strong" as const, reason: "Role title matches a core Scout search lane" };
  if (ADJACENT_ROLE_PATTERN.test(title)) return { fit: "adjacent" as const, reason: "Role is adjacent to Scout's core business/product/operations lanes" };
  return { fit: "unknown" as const, reason: "Role title does not provide a strong deterministic lane match" };
}

function freshnessFrom(postedAt: string | null | undefined, now: Date) {
  if (!postedAt) return { status: "unknown" as const, daysOld: null };
  const posted = Date.parse(postedAt);
  if (!Number.isFinite(posted)) return { status: "unknown" as const, daysOld: null };
  const daysOld = Math.max(0, Math.floor((now.getTime() - posted) / DAY_MS));
  if (daysOld <= 30) return { status: "fresh" as const, daysOld };
  if (daysOld <= 90) return { status: "recent" as const, daysOld };
  if (daysOld <= 180) return { status: "aging" as const, daysOld };
  return { status: "stale" as const, daysOld };
}

function summerFit(text: string, duration: ReturnType<typeof durationFrom>, dates: ReturnType<typeof dateWindowFrom>) {
  if (dates.start !== null && dates.end !== null) {
    if (dates.start >= SUMMER_START && dates.end <= SUMMER_END) {
      return { status: "exact" as const, reason: "Published start/end dates fit fully inside 21 May–31 July 2027" };
    }
    const mentions2027 = new Date(dates.start).getUTCFullYear() === 2027 || new Date(dates.end).getUTCFullYear() === 2027;
    if (mentions2027 && (dates.end < SUMMER_START || dates.start > SUMMER_END)) {
      return { status: "mismatch" as const, reason: "Published 2027 date range does not overlap the 21 May–31 July availability window" };
    }
    if (mentions2027 && (dates.start < SUMMER_START || dates.end > SUMMER_END)) {
      return { status: "mismatch" as const, reason: "Published 2027 date range extends outside the available 21 May–1 July window" };
    }
  }
  if (duration.weeks !== null && duration.weeks > 11) {
    return { status: "mismatch" as const, reason: `Published duration is about ${duration.weeks} weeks, longer than the roughly 10-week Summer 2027 window` };
  }
  if (SUMMER_2027_PATTERN.test(text) && duration.weeks !== null && duration.weeks <= 10) {
    return { status: "compatible" as const, reason: "Posting explicitly targets Summer 2027 and the published duration can fit inside the available window; exact dates still need review" };
  }
  return { status: "unknown" as const, reason: "Posting does not publish enough date/duration evidence to prove Summer 2027 compatibility" };
}

function collegeFit(text: string, hours: ReturnType<typeof hoursFrom>) {
  const fullTime = text.match(FULL_TIME_PATTERN);
  const fixedUs = text.match(FIXED_US_HOURS_PATTERN);
  if (hours.max !== null && hours.max >= 35) return { status: "mismatch" as const, reason: `Published workload reaches ${hours.max} hours/week`, match: text.match(HOURS_PATTERN) };
  if (fullTime) return { status: "mismatch" as const, reason: "Posting explicitly requires full-time availability", match: fullTime };
  if (fixedUs) return { status: "mismatch" as const, reason: "Posting requires fixed US business-hour availability", match: fixedUs };

  const partTime = text.match(PART_TIME_PATTERN);
  const flexible = text.match(FLEXIBLE_PATTERN);
  if (hours.max !== null && hours.max <= 20) return { status: "compatible" as const, reason: `Published workload is at most ${hours.max} hours/week`, match: text.match(HOURS_PATTERN) };
  if (partTime && flexible) return { status: "compatible" as const, reason: "Posting explicitly says part-time with flexible scheduling", match: flexible };
  if (partTime) return { status: "unknown" as const, reason: "Part-time is published, but weekly hours or scheduling flexibility are still missing", match: partTime };
  if (flexible) return { status: "unknown" as const, reason: "Flexible scheduling is published, but the weekly workload is still missing", match: flexible };
  return { status: "unknown" as const, reason: "Remote/location evidence alone is not enough to prove alongside-college compatibility", match: null };
}

function eligibilityFrom(text: string, title: string) {
  const reasons: string[] = [];
  const evidence: FitEvidence[] = [];
  let mismatch = false;
  let compatible = false;

  const senior = title.match(SENIOR_PATTERN);
  if (senior && !EARLY_CAREER_PATTERN.test(title)) {
    mismatch = true;
    reasons.push("Title is explicitly senior/manager-level without an early-career qualifier");
    evidence.push({ code: "seniority", label: "Seniority requirement", excerpt: title });
  }

  const mba = text.match(MBA_REQUIRED_PATTERN);
  if (mba) {
    mismatch = true;
    reasons.push("Posting explicitly requires a graduate-level degree/MBA");
    evidence.push({ code: "graduate_degree_required", label: "Graduate degree requirement", excerpt: excerptAround(text, mba) ?? mba[0] });
  }

  const experience = text.match(EXPERIENCE_PATTERN);
  if (experience) {
    const years = Number(experience[1]);
    if (years >= 2) {
      mismatch = true;
      reasons.push(`Posting explicitly asks for ${years}+ years of prior experience`);
      evidence.push({ code: "experience_required", label: "Prior experience requirement", excerpt: excerptAround(text, experience) ?? experience[0] });
    } else {
      reasons.push("Posting mentions prior experience; review whether it is mandatory");
      evidence.push({ code: "experience_review", label: "Experience language", excerpt: excerptAround(text, experience) ?? experience[0] });
    }
  }

  const graduation = text.match(GRAD_YEAR_PATTERN);
  if (graduation) {
    const first = Number(graduation[1]);
    const second = graduation[2] ? Number(graduation[2]) : first;
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    const overlaps = [...CANDIDATE_GRAD_YEARS].some((year) => year >= low && year <= high);
    evidence.push({ code: "graduation_year", label: "Graduation-year requirement", excerpt: excerptAround(text, graduation) ?? graduation[0] });
    if (overlaps) {
      compatible = true;
      reasons.push(`Published graduation window ${low}${high === low ? "" : `–${high}`} includes 2028/2029`);
    } else {
      mismatch = true;
      reasons.push(`Published graduation window ${low}${high === low ? "" : `–${high}`} excludes both 2028 and 2029`);
    }
  }

  const enrolled = text.match(ENROLLED_PATTERN);
  if (enrolled) {
    compatible = true;
    reasons.push("Posting explicitly accepts currently enrolled undergraduate students");
    evidence.push({ code: "enrolled_student", label: "Current-student eligibility", excerpt: excerptAround(text, enrolled) ?? enrolled[0] });
  }

  return {
    status: mismatch ? "mismatch" as const : compatible ? "compatible" as const : "unknown" as const,
    reasons: reasons.length ? reasons : ["No decisive eligibility requirement was found in persisted posting evidence"],
    evidence,
  };
}

function timingLaneFrom(text: string, summer: Summer2027Fit, college: FitStatus) {
  if (summer === "exact" || summer === "compatible") return "summer_2027" as const;
  if (college === "compatible") return "college_compatible_now" as const;
  if (FUTURE_PATTERN.test(text)) return "future" as const;
  return "unknown" as const;
}

function priorityFrom(input: {
  quality: OpportunityQualityAssessment;
  roleFit: RoleFit;
  summer: Summer2027Fit;
  college: FitStatus;
  eligibility: FitStatus;
  freshness: FreshnessFit;
}) {
  const reasons: string[] = [];
  if (input.quality.tier === "red_flag") reasons.push("Opportunity-quality review contains a high-severity red flag");
  if (input.eligibility === "mismatch") reasons.push("Published eligibility requirements are incompatible");
  if (input.freshness === "stale") reasons.push("Posting is more than 180 days old");
  if (input.summer === "mismatch" && input.college === "mismatch") reasons.push("Both Summer 2027 and alongside-college timing are explicit mismatches");
  if (input.summer === "mismatch" && input.college === "unknown") reasons.push("Summer 2027 is an explicit mismatch and no alongside-college compatibility is proven");
  if (reasons.length) return { priority: "parked" as const, label: "Parked", reasons };

  const timingProven = input.summer === "exact" || input.summer === "compatible" || input.college === "compatible";
  const timingUnknown = input.summer === "unknown" && input.college === "unknown";
  const evidenceStrong = input.quality.officialSnapshot && input.quality.registeredSource;

  if (input.roleFit === "strong" && timingProven && evidenceStrong && input.freshness !== "aging") {
    return { priority: "A" as const, label: "Priority A", reasons: ["Core role lane", "Timing compatibility is supported by published evidence", "Official job evidence is bound"] };
  }
  if ((input.roleFit === "strong" || input.roleFit === "adjacent") && (timingProven || timingUnknown)) {
    const why = [input.roleFit === "strong" ? "Core role lane" : "Adjacent role lane"];
    if (timingUnknown) why.push("Important timing details remain unknown rather than mismatched");
    else why.push("At least one target timing lane is compatible");
    return { priority: "B" as const, label: "Priority B", reasons: why };
  }
  return { priority: "C" as const, label: "Priority C", reasons: [input.roleFit === "stretch" ? "Stretch role lane" : "Role/timing evidence is weaker or incomplete"] };
}

export function assessOpportunityFit(
  job: OpportunityQualityJob,
  quality: OpportunityQualityAssessment,
  now = new Date(),
): OpportunityFitAssessment {
  const text = cleanText(`${job.title}. ${job.description}. ${job.location}`);
  const duration = durationFrom(text);
  const hours = hoursFrom(text);
  const dates = dateWindowFrom(text);
  const summer = summerFit(text, duration, dates);
  const college = collegeFit(text, hours);
  const role = roleFitFrom(job.title);
  const eligibility = eligibilityFrom(text, job.title);
  const freshness = freshnessFrom(job.postedAt, now);
  const timingLane = timingLaneFrom(text, summer.status, college.status);
  const priority = priorityFrom({
    quality,
    roleFit: role.fit,
    summer: summer.status,
    college: college.status,
    eligibility: eligibility.status,
    freshness: freshness.status,
  });

  const evidence: FitEvidence[] = [...eligibility.evidence];
  if (duration.evidence) evidence.push({ code: "duration", label: "Published duration", excerpt: duration.evidence });
  if (hours.evidence) evidence.push({ code: "hours", label: "Published weekly hours", excerpt: hours.evidence });
  if (dates.evidence) evidence.push({ code: "date_window", label: "Published internship dates", excerpt: dates.evidence });
  if (college.match) evidence.push({ code: "college_schedule", label: "Published scheduling evidence", excerpt: excerptAround(text, college.match) ?? college.match[0] });

  const unknowns: string[] = [];
  if (summer.status === "unknown") unknowns.push("Summer 2027 dates/duration");
  if (college.status === "unknown") unknowns.push("Alongside-college hours/schedule");
  if (eligibility.status === "unknown") unknowns.push("Candidate eligibility");
  if (freshness.status === "unknown") unknowns.push("Posting date");

  return {
    priority: priority.priority,
    priorityLabel: priority.label,
    priorityReasons: priority.reasons,
    timingLane,
    summer2027: summer.status,
    summerReason: summer.reason,
    collegeCompatibility: college.status,
    collegeReason: college.reason,
    roleFit: role.fit,
    roleReason: role.reason,
    eligibility: eligibility.status,
    eligibilityReasons: eligibility.reasons,
    duration,
    hoursPerWeek: hours,
    dateWindow: { start: isoDay(dates.start), end: isoDay(dates.end), evidence: dates.evidence },
    freshness,
    evidence,
    unknowns,
  };
}
