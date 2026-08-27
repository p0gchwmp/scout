export type OpportunityType = "internship" | "fellowship" | "research_project" | "full_time" | "unknown";
export type OpportunityTrack = "now_remote" | "summer_2027" | "other_internship" | "fellowships" | "research" | "jobs";
export type CollegeCompatibility = "promising" | "likely_conflict" | "unknown" | "not_remote";
export type SummerWindowFit = "strong" | "compatible" | "mismatch" | "unknown" | "not_applicable";
export type CultureSignal = "watchlist" | "culture_adjacent" | "neutral";

export type OpportunityTrackInput = {
  company: string;
  title: string;
  location: string;
  focus?: string;
  description?: string;
  workplaceType?: string;
};

export type OpportunityTrackAssessment = {
  opportunityType: OpportunityType;
  track: OpportunityTrack;
  isRemote: boolean;
  isIndia: boolean;
  collegeCompatibility: CollegeCompatibility;
  collegeCompatibilityReason: string;
  summerWindowFit: SummerWindowFit;
  summerWindowReason: string;
  cultureSignal: CultureSignal;
  cultureReason: string | null;
  eligibilityFlags: string[];
};

export const SUMMER_2027_WINDOW = Object.freeze({
  start: "2027-05-21",
  end: "2027-07-31",
  label: "21 May – 31 Jul 2027",
} as const);

export const OPPORTUNITY_TRACK_LABELS: Readonly<Record<OpportunityTrack, string>> = Object.freeze({
  now_remote: "Now · Remote",
  summer_2027: "Summer 2027",
  other_internship: "Other internships",
  fellowships: "Fellowships",
  research: "Research projects",
  jobs: "Jobs",
});

export const OPPORTUNITY_TYPE_LABELS: Readonly<Record<OpportunityType, string>> = Object.freeze({
  internship: "Internship",
  fellowship: "Fellowship",
  research_project: "Research / live project",
  full_time: "Permanent / full-time",
  unknown: "Unclassified job",
});

// This is a soft discovery/watch signal only. It never overrides eligibility,
// evidence quality, role fit, date fit, work authorization, or user review.
export const CULTURE_RELEVANT_BRAND_WATCHLIST = Object.freeze([
  "Roblox", "Discord", "Reddit", "Twitch", "Spotify", "YouTube", "TikTok", "Snap",
  "Riot Games", "Epic Games", "Supercell", "Duolingo", "Canva", "Figma", "Notion",
  "Nike", "Adidas", "Puma", "Monster Energy", "Red Bull", "Netflix", "Apple",
  "Nothing", "OnePlus", "CRED", "Zepto", "Blinkit", "Swiggy", "Zomato", "Myntra",
  "Nykaa", "boAt", "Meesho", "Razorpay", "PhonePe",
] as const);

const INDIA_CONTEXT_PATTERN = /\b(india|bengaluru|bangalore|chennai|hyderabad|noida|gurugram|gurgaon|mumbai|delhi|new delhi|pune|kolkata|jammu|ahmedabad|jaipur|chandigarh|kochi|cochin|coimbatore|indore|bhubaneswar|goa|lucknow|surat|vadodara)\b/i;
const REMOTE_CONTEXT_PATTERN = /\b(remote|work from home|wfh|distributed|anywhere)\b/i;
const INTERNSHIP_PATTERN = /\b(intern|internship|trainee|apprentice|co[- ]?op)\b/i;
const FELLOWSHIP_PATTERN = /\b(fellowship|fellow|scholarship|student programme|student program)\b/i;
const RESEARCH_PROJECT_PATTERN = /\b(research assistant|research associate|research project|live project|student researcher|research volunteer|lab assistant|project assistant)\b/i;
const FULL_TIME_SIGNAL_PATTERN = /\b(full[- ]?time|permanent|graduate role|new grad|entry[- ]?level|analyst|engineer|developer|manager|specialist|consultant|executive|officer|associate)\b/i;
const SUMMER_2027_PATTERN = /\b(?:summer\s+2027|2027\s+summer|may\s+2027|june\s+2027|july\s+2027)\b/i;
const OTHER_YEAR_PATTERN = /\b(?:summer\s+2026|summer\s+2028|2026\s+summer|2028\s+summer)\b/i;
const EXACT_WINDOW_PATTERN = /\b(?:21(?:st)?\s+may|may\s+21(?:st)?)\b[\s\S]{0,120}\b(?:31(?:st)?\s+jul(?:y)?|jul(?:y)?\s+31(?:st)?)\b/i;
const COMPATIBLE_DURATION_PATTERN = /\b(?:8|9|10|11|12)\s*[- ]?weeks?\b|\b(?:two|2)[ -]?months?\b/i;
const LONG_DURATION_PATTERN = /\b(?:4|5|6|7|8|9|10|11|12)\s*[- ]?months?\b|\b(?:16|18|20|22|24|26|28|30|32|36|40|48|52)\s*[- ]?weeks?\b/i;
const COLLEGE_FRIENDLY_PATTERN = /\b(part[- ]?time|flexible hours?|flexible schedule|async(?:hronous)?|student friendly|alongside (?:college|studies)|evenings?|weekends?|10\s*[-–]\s*20\s*hours?\s*(?:per|\/)\s*week|up to 20 hours?\s*(?:per|\/)\s*week)\b/i;
const COLLEGE_CONFLICT_PATTERN = /\b(full[- ]?time|40\s*hours?\s*(?:per|\/)\s*week|(?:6|7|8|9)\s*hours?\s*(?:per|\/)\s*day|six days?\s*(?:per|\/)\s*week|6 days?\s*(?:per|\/)\s*week|10\s*(?:am|a\.m\.)\s*(?:-|–|to)\s*7\s*(?:pm|p\.m\.))\b/i;
const CULTURE_CATEGORY_PATTERN = /\b(gaming|game studio|creator economy|social media|social platform|streaming|music|sportswear|streetwear|fashion|consumer app|consumer tech|quick commerce|food delivery|youth brand|internet culture|esports|fintech consumer)\b/i;
const US_AUTH_PATTERN = /\b(?:authorized|authorised) to work in (?:the )?(?:u\.?s\.?|united states)|\bu\.?s\.? work authori[sz]ation|\bvisa sponsorship\b/i;
const COUNTRY_AUTH_PATTERN = /\bwork authori[sz]ation\b|\bright to work\b|\bvisa sponsorship\b/i;

function combinedText(input: OpportunityTrackInput) {
  return [input.company, input.title, input.location, input.focus ?? "", input.description ?? "", input.workplaceType ?? ""].join("\n");
}

// Track/eligibility decisions use posting/result evidence only. Search-lane focus text
// is deliberately excluded so a broad query cannot manufacture remote/date eligibility.
function evidenceText(input: OpportunityTrackInput) {
  return [input.title, input.location, input.description ?? "", input.workplaceType ?? ""].join("\n");
}

function normalizeCompany(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyOpportunityType(input: OpportunityTrackInput): OpportunityType {
  const text = evidenceText(input);
  if (FELLOWSHIP_PATTERN.test(input.title)) return "fellowship";
  if (INTERNSHIP_PATTERN.test(text)) return "internship";
  if (RESEARCH_PROJECT_PATTERN.test(text)) return "research_project";
  if (FULL_TIME_SIGNAL_PATTERN.test(input.title)) return "full_time";
  return "unknown";
}

export function isRemoteOpportunity(input: OpportunityTrackInput) {
  return input.workplaceType?.toLowerCase() === "remote" || REMOTE_CONTEXT_PATTERN.test(evidenceText(input));
}

export function isIndiaOpportunity(input: OpportunityTrackInput) {
  return INDIA_CONTEXT_PATTERN.test(`${input.location}\n${input.description ?? ""}`);
}

function assessCollegeCompatibility(input: OpportunityTrackInput, isRemote: boolean) {
  if (!isRemote) return {
    collegeCompatibility: "not_remote" as const,
    collegeCompatibilityReason: "Not presented as a remote opportunity.",
  };
  const text = evidenceText(input);
  if (COLLEGE_CONFLICT_PATTERN.test(text)) return {
    collegeCompatibility: "likely_conflict" as const,
    collegeCompatibilityReason: "Posting text suggests a substantial fixed/full-time commitment; compare it with the college timetable before applying.",
  };
  if (COLLEGE_FRIENDLY_PATTERN.test(text)) return {
    collegeCompatibility: "promising" as const,
    collegeCompatibilityReason: "Posting text includes an explicit part-time/flexible signal; still confirm the actual timetable before applying.",
  };
  return {
    collegeCompatibility: "unknown" as const,
    collegeCompatibilityReason: "Remote is explicit, but schedule compatibility with college is not. Confirm hours/days before applying.",
  };
}

function assessSummerWindow(input: OpportunityTrackInput, opportunityType: OpportunityType) {
  if (opportunityType !== "internship") return {
    summerWindowFit: "not_applicable" as const,
    summerWindowReason: "The Summer 2027 corporate window applies to internships.",
  };
  const text = evidenceText(input);
  if (OTHER_YEAR_PATTERN.test(text)) return {
    summerWindowFit: "mismatch" as const,
    summerWindowReason: `Posting text points to a different internship season than ${SUMMER_2027_WINDOW.label}.`,
  };
  if (LONG_DURATION_PATTERN.test(text)) return {
    summerWindowFit: "mismatch" as const,
    summerWindowReason: `Posting text suggests a duration substantially longer than the ${SUMMER_2027_WINDOW.label} window.`,
  };
  if (EXACT_WINDOW_PATTERN.test(text)) return {
    summerWindowFit: "strong" as const,
    summerWindowReason: `Posting text explicitly aligns with the ${SUMMER_2027_WINDOW.label} window.`,
  };
  if (SUMMER_2027_PATTERN.test(text)) return {
    summerWindowFit: "compatible" as const,
    summerWindowReason: `Posting text names Summer 2027, but exact ${SUMMER_2027_WINDOW.label} dates still need confirmation.`,
  };
  if (COMPATIBLE_DURATION_PATTERN.test(text)) return {
    summerWindowFit: "compatible" as const,
    summerWindowReason: `Duration looks compatible with the ${SUMMER_2027_WINDOW.label} window, but the posting does not establish the 2027 season/dates.`,
  };
  return {
    summerWindowFit: "unknown" as const,
    summerWindowReason: `Dates/duration are not explicit enough to confirm the ${SUMMER_2027_WINDOW.label} window.`,
  };
}

function assessCulture(input: OpportunityTrackInput) {
  const company = normalizeCompany(input.company);
  const exact = CULTURE_RELEVANT_BRAND_WATCHLIST.find((brand) => {
    const normalized = normalizeCompany(brand);
    return company === normalized || company.includes(normalized) || normalized.includes(company);
  });
  if (exact) return {
    cultureSignal: "watchlist" as const,
    cultureReason: `${exact} is on the youth/culture/internet-relevance watchlist. This is only a soft discovery preference.`,
  };
  if (CULTURE_CATEGORY_PATTERN.test(combinedText(input))) return {
    cultureSignal: "culture_adjacent" as const,
    cultureReason: "The company/role sits in a youth-facing or internet-culture-adjacent category. This is only a soft discovery preference.",
  };
  return { cultureSignal: "neutral" as const, cultureReason: null };
}

function eligibilityFlags(input: OpportunityTrackInput) {
  const text = evidenceText(input);
  const flags: string[] = [];
  if (US_AUTH_PATTERN.test(text)) flags.push("US work-authorization/sponsorship language needs manual eligibility review");
  else if (COUNTRY_AUTH_PATTERN.test(text)) flags.push("Work-authorization language needs manual eligibility review");
  return flags;
}

export function assessOpportunityTrack(input: OpportunityTrackInput): OpportunityTrackAssessment {
  const opportunityType = classifyOpportunityType(input);
  const isRemote = isRemoteOpportunity(input);
  const isIndia = isIndiaOpportunity(input);
  const college = assessCollegeCompatibility(input, isRemote);
  const summer = assessSummerWindow(input, opportunityType);
  const culture = assessCulture(input);
  const evidence = evidenceText(input);

  let track: OpportunityTrack;
  if (opportunityType === "fellowship") track = "fellowships";
  else if (opportunityType === "research_project") track = "research";
  else if (opportunityType === "full_time" || opportunityType === "unknown") track = "jobs";
  else if (SUMMER_2027_PATTERN.test(evidence) || summer.summerWindowFit === "strong") track = "summer_2027";
  else if (isRemote) track = "now_remote";
  else track = "other_internship";

  return {
    opportunityType,
    track,
    isRemote,
    isIndia,
    ...college,
    ...summer,
    ...culture,
    eligibilityFlags: eligibilityFlags(input),
  };
}

export function matchesOpportunityRegion(input: OpportunityTrackInput, region: "All" | "India" | "Remote" | "Global") {
  if (region === "All") return true;
  const assessed = assessOpportunityTrack(input);
  if (region === "India") return assessed.isIndia;
  if (region === "Remote") return assessed.isRemote;
  return !assessed.isIndia;
}
