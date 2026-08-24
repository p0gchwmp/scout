import type { BraveSearchResult } from "../lib/scout/brave-search.ts";
import { classifyPlatformUrl } from "../lib/scout/platform-registry.ts";
import { createAgentSearchProvider } from "./search-runtime.ts";

export const SEARCH_DISCOVERY_QUERIES = Object.freeze([
  {
    id: "linkedin",
    focus: "LinkedIn internship leads across Scout target functions",
    query: "site:linkedin.com/jobs/view internship India remote product operations business finance policy health-tech",
  },
  {
    id: "glassdoor",
    focus: "Glassdoor internship leads for India and remote roles",
    query: "site:glassdoor.co.in internship India product operations business finance policy health OR site:glassdoor.com internship India remote",
  },
  {
    id: "internship_boards",
    focus: "India internship boards and startups",
    query: "internship India remote site:internshala.com/internship OR site:wellfound.com/jobs OR site:unstop.com/internships OR site:cutshort.io OR site:foundit.in",
  },
  {
    id: "workday_bamboo",
    focus: "Workday and BambooHR employer postings",
    query: "internship India remote site:myworkdayjobs.com OR site:myworkdaysite.com OR site:bamboohr.com/jobs",
  },
  {
    id: "modern_ats",
    focus: "official modern ATS internships",
    query: "intern India remote site:jobs.ashbyhq.com OR site:apply.workable.com OR site:jobs.smartrecruiters.com OR site:jobs.lever.co OR site:job-boards.greenhouse.io",
  },
  {
    id: "ats_long_tail",
    focus: "public employer ATS long tail",
    query: "internship India site:teamtailor.com OR site:recruitee.com OR site:breezy.hr OR site:applytojob.com OR site:pinpointhq.com OR site:jobs.personio.de",
  },
  {
    id: "forms",
    focus: "startup and direct application forms",
    query: "internship India site:tally.so OR site:typeform.com OR site:fillout.com OR site:forms.gle OR site:jotform.com OR site:forms.office.com",
  },
  {
    id: "company_careers",
    focus: "direct company careers pages in Scout target functions",
    query: "internship India remote product operations business finance public policy health tech careers jobs company",
  },
] as const);

export type SearchIndexLead = {
  provider: "search_index";
  canonicalUrl: string;
  company: string;
  title: string;
  sourceUrl: string;
  focus: string;
  location: string;
  postedAt: null;
  platformId: string;
  nextStep: string;
};

function cleanTitle(value: string) {
  return value
    .replace(/\s*[|–—-]\s*(LinkedIn|Glassdoor|Internshala|Indeed|Wellfound|Unstop|Foundit|Cutshort)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function domainLabel(hostname: string) {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".");
  const meaningful = parts.filter((part) => !["jobs", "careers", "job", "www", "apply", "boards", "job-boards"].includes(part));
  return meaningful[0] || hostname.toLowerCase();
}

function inferCompanyAndTitle(result: BraveSearchResult, platformId: string, platformKind: string, platformLabel: string) {
  const title = cleanTitle(result.title);
  if (platformId === "linkedin") {
    const match = title.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+.+$/i);
    if (match) return { company: match[1].trim().slice(0, 200), title: match[2].trim().slice(0, 300) };
  }
  if (platformId === "internshala") {
    const match = title.match(/^(.+?)\s+Internship\s+at\s+(.+)$/i);
    if (match) return { company: match[2].trim().slice(0, 200), title: `${match[1].trim()} Internship`.slice(0, 300) };
  }
  if (platformId === "glassdoor") {
    const roleCompany = title.match(/^(.+?)\s+[-|]\s+(.+?)$/);
    if (roleCompany && /intern|trainee|apprentice/i.test(roleCompany[1])) {
      return { company: roleCompany[2].trim().slice(0, 200), title: roleCompany[1].trim().slice(0, 300) };
    }
  }
  if (platformKind === "form") {
    return { company: `Unresolved ${platformLabel} lead`.slice(0, 200), title: title || "Internship application form" };
  }
  const url = new URL(result.url);
  return { company: domainLabel(url.hostname), title: title || "Internship opportunity" };
}

function inferLocation(text: string) {
  const matches = text.match(/\b(Remote|India|Bengaluru|Bangalore|Chennai|Hyderabad|Noida|Gurugram|Gurgaon|Mumbai|Delhi|Pune|Kolkata|Jammu)\b/gi) ?? [];
  return [...new Set(matches.map((item) => item[0].toUpperCase() + item.slice(1).toLowerCase()))].slice(0, 3).join(" / ");
}

function isLikelyJobResult(result: BraveSearchResult, platformKind: string) {
  if (platformKind !== "company") return true;
  const url = new URL(result.url);
  return /job|career|intern|apply|opportunit|vacan|opening|join/i.test(`${url.pathname} ${url.search} ${result.title} ${result.description}`);
}

function normalizeResult(result: BraveSearchResult, focus: string): SearchIndexLead | null {
  const platform = classifyPlatformUrl(result.url);
  if (platform.id === "unknown" || !isLikelyJobResult(result, platform.kind)) return null;
  const inferred = inferCompanyAndTitle(result, platform.id, platform.kind, platform.label);
  return {
    provider: "search_index",
    canonicalUrl: result.url,
    company: inferred.company,
    title: inferred.title,
    sourceUrl: result.url,
    focus,
    location: inferLocation(`${result.title} ${result.description}`),
    postedAt: null,
    platformId: platform.id,
    nextStep: platform.requiresOfficialResolution
      ? `Search-index ${platform.label} lead; resolve employer and official job evidence before application preparation.`
      : `Search-index ${platform.label} lead; capture and verify official posting evidence before application preparation.`,
  };
}

export async function discoverSearchIndexInternships(environment: NodeJS.ProcessEnv = process.env) {
  const provider = createAgentSearchProvider(environment);
  if (!provider) return { enabled: false, leads: [] as SearchIndexLead[], failures: [] as Array<{ company: string; provider: string; reason: string }> };
  if (!provider.allowResultPersistence) {
    return {
      enabled: true,
      leads: [] as SearchIndexLead[],
      failures: [{ company: "Search index", provider: provider.provider, reason: "Search result persistence is not explicitly allowed by configuration" }],
    };
  }

  const settled = await Promise.allSettled(SEARCH_DISCOVERY_QUERIES.map(async (query) => ({ query, results: await provider.searchFixedQuery(query.query) })));
  const leads: SearchIndexLead[] = [];
  const failures: Array<{ company: string; provider: string; reason: string }> = [];

  settled.forEach((result, index) => {
    const query = SEARCH_DISCOVERY_QUERIES[index];
    if (result.status === "rejected") {
      failures.push({ company: `Search query: ${query.id}`, provider: provider.provider, reason: "Search index temporarily unavailable" });
      return;
    }
    for (const item of result.value.results) {
      const lead = normalizeResult(item, query.focus);
      if (lead) leads.push(lead);
    }
  });

  const deduped = [...new Map(leads.map((lead) => [lead.canonicalUrl, lead])).values()].slice(0, 100);
  return { enabled: true, leads: deduped, failures };
}
