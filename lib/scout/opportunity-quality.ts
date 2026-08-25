export const OPPORTUNITY_QUALITY_CAPABILITIES = Object.freeze({
  exactUrlDedupe: true,
  conservativeCrossUrlDedupe: true,
  preferOfficialAts: true,
  preserveDiscoveryProvenance: true,
  suppressClearlySeniorSearchNoise: true,
  suppressVeryStaleSearchNoise: true,
  autoRejectOpportunity: false,
  geographyBias: false,
} as const);

export type OpportunityQualityTier = "high" | "review" | "low_signal";

export type OpportunityDiscoveryLead = {
  provider: string;
  canonicalUrl: string;
  company: string;
  title: string;
  sourceUrl: string;
  focus: string;
  location: string;
  postedAt: string | null;
  platformId: string;
  nextStep: string;
};

export type ConsolidatedOpportunityLead<T extends OpportunityDiscoveryLead = OpportunityDiscoveryLead> = T & {
  opportunityKey: string;
  duplicateCount: number;
  provenanceUrls: string[];
  provenancePlatforms: string[];
  qualityTier: OpportunityQualityTier;
  qualityReasons: string[];
  authorityLabel: string;
};

export type OpportunityQualitySummary = {
  inputCount: number;
  uniqueCount: number;
  duplicatesCollapsed: number;
  suppressedLowSignal: number;
};

type OpportunityIdentityInput = Pick<OpportunityDiscoveryLead, "provider" | "canonicalUrl" | "company" | "title" | "location" | "postedAt">;

const ATS_PLATFORM_IDS = new Set([
  "greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday", "bamboohr",
  "icims", "jobvite", "recruitee", "teamtailor", "breezyhr", "jazzhr", "pinpoint", "personio",
  "rippling", "freshteam", "zohorecruit", "oracle", "successfactors", "taleo", "adp", "eightfold",
  "phenom", "avature",
]);
const JOB_BOARD_IDS = new Set(["linkedin", "internshala", "glassdoor", "indeed", "naukri", "wellfound", "unstop", "cutshort", "foundit"]);
const FORM_IDS = new Set(["tally", "google_forms", "typeform", "fillout", "jotform", "microsoft_forms"]);
const EARLY_CAREER_PATTERN = /\b(?:intern|internship|trainee|apprentice|co[- ]?op|graduate|new grad|entry[- ]?level|fresher|student|associate|junior)\b/i;
const SENIOR_PATTERN = /\b(?:senior|staff|principal|director|head of|vice president|vp|engineering manager|product manager|program manager|project manager|team lead)\b/i;
const GENERIC_TITLE_PATTERN = /^(?:intern|internship|internship opportunity|job opportunity|career opportunity|application form|internship application form)$/i;

function normalizeWords(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompany(value: string) {
  return normalizeWords(value)
    .replace(/\b(?:private limited|pvt ltd|pvt limited|limited|ltd|incorporated|inc|llc|plc|corp|corporation)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRole(value: string) {
  return normalizeWords(value)
    .replace(/\b(?:internship|intern|trainee|apprentice|co op)\b/g, " ")
    .replace(/\b(?:summer|winter)\s+20\d{2}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocation(value: string) {
  const words = normalizeWords(value);
  if (!words) return "unknown";
  if (/\b(?:remote|work from home|wfh|distributed)\b/.test(words)) return "remote";
  return words;
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "source", "trk"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function authority(lead: OpportunityDiscoveryLead) {
  if (lead.provider !== "search_index") return { score: 100, label: "Controlled official ATS" };
  if (ATS_PLATFORM_IDS.has(lead.platformId)) return { score: 85, label: "Official ATS discovered by search" };
  if (lead.platformId === "company") return { score: 75, label: "Official company page discovered by search" };
  if (JOB_BOARD_IDS.has(lead.platformId)) return { score: 50, label: "Job-board lead requiring official resolution" };
  if (FORM_IDS.has(lead.platformId)) return { score: 35, label: "Application-form lead requiring official provenance" };
  return { score: 25, label: "Search lead requiring official resolution" };
}

function postedTimestamp(value: string | null) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function locationsCompatible(left: OpportunityIdentityInput, right: OpportunityIdentityInput) {
  const a = normalizeLocation(left.location);
  const b = normalizeLocation(right.location);
  if (a === b) return true;
  if (a !== "unknown" && b !== "unknown") return false;

  // Unknown-location cross-source matches are allowed only when one side is an
  // official/controlled source and the other is a search lead. This avoids merging
  // two same-title openings in different known cities.
  const mixedAuthority = (left.provider === "search_index") !== (right.provider === "search_index");
  if (!mixedAuthority) return false;
  const leftPosted = postedTimestamp(left.postedAt);
  const rightPosted = postedTimestamp(right.postedAt);
  if (!leftPosted || !rightPosted) return true;
  return Math.abs(leftPosted - rightPosted) <= 45 * 86_400_000;
}

export function sameOpportunityIdentity(left: OpportunityIdentityInput, right: OpportunityIdentityInput) {
  if (normalizedUrl(left.canonicalUrl) === normalizedUrl(right.canonicalUrl)) return true;
  const leftCompany = normalizeCompany(left.company);
  const rightCompany = normalizeCompany(right.company);
  const leftRole = normalizeRole(left.title);
  const rightRole = normalizeRole(right.title);
  if (!leftCompany || !rightCompany || !leftRole || !rightRole) return false;
  return leftCompany === rightCompany && leftRole === rightRole && locationsCompatible(left, right);
}

function shouldSuppress(lead: OpportunityDiscoveryLead, now: Date) {
  if (lead.provider !== "search_index") return false;
  if (SENIOR_PATTERN.test(lead.title) && !EARLY_CAREER_PATTERN.test(lead.title)) return true;
  const posted = postedTimestamp(lead.postedAt);
  if (posted && now.getTime() - posted > 365 * 86_400_000) return true;
  return false;
}

function quality(lead: OpportunityDiscoveryLead, duplicateCount: number) {
  const source = authority(lead);
  const reasons: string[] = [source.label];
  let tier: OpportunityQualityTier = source.score >= 75 ? "high" : source.score >= 50 ? "review" : "low_signal";

  if (!lead.location.trim()) {
    reasons.push("Location is not explicit in the discovery lead");
    if (tier === "high") tier = "review";
  }
  if (GENERIC_TITLE_PATTERN.test(lead.title.trim()) || /^unresolved\b/i.test(lead.company.trim())) {
    reasons.push("Lead title/company is generic and needs official resolution");
    tier = "low_signal";
  }
  if (duplicateCount > 0) reasons.push(`Consolidated ${duplicateCount} duplicate discovery lead${duplicateCount === 1 ? "" : "s"}`);
  return { tier, reasons, authorityLabel: source.label };
}

function opportunityKey(lead: OpportunityDiscoveryLead) {
  return `${normalizeCompany(lead.company)}|${normalizeRole(lead.title)}|${normalizeLocation(lead.location)}`.slice(0, 700);
}

export function consolidateOpportunityLeads<T extends OpportunityDiscoveryLead>(
  input: readonly T[],
  now = new Date(),
): { leads: ConsolidatedOpportunityLead<T>[]; summary: OpportunityQualitySummary } {
  const candidates = input.filter((lead) => !shouldSuppress(lead, now));
  const suppressedLowSignal = input.length - candidates.length;
  const sorted = [...candidates].sort((left, right) => {
    const authorityDelta = authority(right).score - authority(left).score;
    if (authorityDelta) return authorityDelta;
    return postedTimestamp(right.postedAt) - postedTimestamp(left.postedAt)
      || left.company.localeCompare(right.company)
      || left.title.localeCompare(right.title);
  });

  const groups: Array<{ representative: T; members: T[] }> = [];
  for (const lead of sorted) {
    const existing = groups.find((group) => group.members.some((member) => sameOpportunityIdentity(member, lead)));
    if (existing) existing.members.push(lead);
    else groups.push({ representative: lead, members: [lead] });
  }

  const leads = groups.map(({ representative, members }) => {
    const provenanceUrls = [...new Set(members.flatMap((member) => [member.canonicalUrl, member.sourceUrl]).map(normalizedUrl))].slice(0, 12);
    const provenancePlatforms = [...new Set(members.map((member) => member.platformId || member.provider))].slice(0, 12);
    const duplicateCount = Math.max(0, members.length - 1);
    const assessed = quality(representative, duplicateCount);
    return {
      ...representative,
      opportunityKey: opportunityKey(representative),
      duplicateCount,
      provenanceUrls,
      provenancePlatforms,
      qualityTier: assessed.tier,
      qualityReasons: assessed.reasons,
      authorityLabel: assessed.authorityLabel,
    };
  });

  return {
    leads: leads.slice(0, 100),
    summary: {
      inputCount: input.length,
      uniqueCount: Math.min(100, leads.length),
      duplicatesCollapsed: groups.reduce((total, group) => total + Math.max(0, group.members.length - 1), 0),
      suppressedLowSignal,
    },
  };
}
