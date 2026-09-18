import { assessOpportunityTrack, CULTURE_RELEVANT_BRAND_WATCHLIST, PRESTIGE_BRAND_WATCHLIST } from "./opportunity-tracks.ts";

export type AutopilotSource = {
  id: string;
  companyName: string;
  companyDomain: string;
  enabled: boolean;
};

export type AutopilotJob = {
  id: string;
  sourceRegistryId: string | null;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: string;
  score: number;
  lifecycleState: string;
};

export type CompanyAutopilotCandidate = {
  companyName: string;
  companyDomain: string;
  officialUrl: string;
  track: "now_remote" | "summer_2027";
  researchFocus: string;
  priorityScore: number;
  origin: "controlled_source" | "watchlist";
  reasons: string[];
};

// Bootstrap suggestions only. The normal queue is open-ended over every enabled\n// Scout company source discovered from verified jobs; this list is not a ceiling.\nconst CONTROLLED_WATCHLIST_SEEDS = Object.freeze([
  { companyName: "Roblox", companyDomain: "roblox.com", focus: "consumer product, gaming, creator ecosystem, operations" },
  { companyName: "CRED", companyDomain: "cred.club", focus: "consumer fintech, product, business, operations" },
  { companyName: "Nike", companyDomain: "nike.com", focus: "consumer brand, digital product, business, operations" },
  { companyName: "Canva", companyDomain: "canva.com", focus: "product, design technology, business, operations" },
  { companyName: "Figma", companyDomain: "figma.com", focus: "product, design technology, operations, business" },
  { companyName: "Notion", companyDomain: "notion.so", focus: "product, productivity software, business, operations" },
  { companyName: "Spotify", companyDomain: "spotify.com", focus: "consumer product, media technology, analytics, business" },
  { companyName: "OpenAI", companyDomain: "openai.com", focus: "AI product, operations, research, policy" },
  { companyName: "Microsoft", companyDomain: "microsoft.com", focus: "product, business, operations, research, technology" },
  { companyName: "Mastercard", companyDomain: "mastercard.com", focus: "finance, economics, product, business, analytics" },
  { companyName: "Razorpay", companyDomain: "razorpay.com", focus: "India fintech, product, business, operations, finance" },
  { companyName: "PhonePe", companyDomain: "phonepe.com", focus: "India fintech, product, operations, business" },
] as const);

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function companyMatch(left: string, right: string) {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function brandBoost(companyName: string) {
  const culture = CULTURE_RELEVANT_BRAND_WATCHLIST.some((brand) => companyMatch(companyName, brand));
  const prestige = PRESTIGE_BRAND_WATCHLIST.some((brand) => companyMatch(companyName, brand));
  return { culture, prestige, score: (culture ? 10 : 0) + (prestige ? 10 : 0) };
}

function focusFromJobs(items: AutopilotJob[]) {
  const text = items
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((job) => `${job.title} ${job.description.slice(0, 320)}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 900) || "product, business, operations, research";
}

export function buildCompanyAutopilotQueue(input: {
  sources: AutopilotSource[];
  jobs: AutopilotJob[];
  existingDomains?: string[];
  limit?: number;
}) {
  const existing = new Set((input.existingDomains ?? []).map((domain) => domain.toLowerCase()));
  const candidates = new Map<string, CompanyAutopilotCandidate>();
  const activeJobs = input.jobs.filter((job) => job.lifecycleState === "active");

  for (const source of input.sources.filter((item) => item.enabled)) {
    if (existing.has(source.companyDomain.toLowerCase())) continue;
    const companyJobs = activeJobs.filter((job) => job.sourceRegistryId === source.id || companyMatch(job.company, source.companyName));
    const assessments = companyJobs.map((job) => ({
      job,
      assessment: assessOpportunityTrack({
        company: job.company,
        title: job.title,
        location: job.location,
        description: job.description,
        workplaceType: job.workplaceType,
      }),
    }));
    const hasNowRemote = assessments.some(({ assessment }) => assessment.track === "now_remote" && assessment.collegeCompatibility !== "likely_conflict");
    const boost = brandBoost(source.companyName);
    const bestJobScore = companyJobs.reduce((best, job) => Math.max(best, job.score), 0);
    const reasons = ["Controlled Scout company source"];
    if (hasNowRemote) reasons.push("Current remote internship signal");
    if (boost.culture) reasons.push("Culture/internet relevance watchlist");
    if (boost.prestige) reasons.push("Prestige/career-brand watchlist");
    candidates.set(source.companyDomain.toLowerCase(), {
      companyName: source.companyName,
      companyDomain: source.companyDomain.toLowerCase(),
      officialUrl: `https://${source.companyDomain.toLowerCase()}/`,
      track: hasNowRemote ? "now_remote" : "summer_2027",
      researchFocus: focusFromJobs(companyJobs),
      priorityScore: Math.min(100, 42 + boost.score + Math.round(bestJobScore / 5) + (hasNowRemote ? 12 : 0)),
      origin: "controlled_source",
      reasons,
    });
  }

  for (const seed of CONTROLLED_WATCHLIST_SEEDS) {
    const domain = seed.companyDomain.toLowerCase();
    if (existing.has(domain) || candidates.has(domain)) continue;
    const boost = brandBoost(seed.companyName);
    candidates.set(domain, {
      companyName: seed.companyName,
      companyDomain: domain,
      officialUrl: `https://${domain}/`,
      track: "summer_2027",
      researchFocus: seed.focus,
      priorityScore: Math.min(100, 50 + boost.score),
      origin: "watchlist",
      reasons: ["Controlled company outreach watchlist", ...(boost.culture ? ["Culture/internet relevance watchlist"] : []), ...(boost.prestige ? ["Prestige/career-brand watchlist"] : [])],
    });
  }

  return [...candidates.values()]
    .sort((left, right) => right.priorityScore - left.priorityScore || left.companyName.localeCompare(right.companyName))
    .slice(0, Math.max(1, Math.min(input.limit ?? 40, 100)));
}
