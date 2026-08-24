import type { BraveSearchResult } from "../lib/scout/brave-search.ts";
import { classifyPlatformUrl } from "../lib/scout/platform-registry.ts";
import { createAgentSearchProvider } from "./search-runtime.ts";

export const SEARCH_DISCOVERY_QUERIES = Object.freeze([
  { id: "linkedin", focus: "product, business, operations, finance, policy, health-tech", query: "site:linkedin.com/jobs/view internship India remote product operations business finance policy health" },
  { id: "internship_boards", focus: "India internship boards and startups", query: "internship India remote site:internshala.com/internship OR site:wellfound.com/jobs OR site:unstop.com/internships" },
  { id: "ats", focus: "official ATS internships", query: "intern India remote site:myworkdayjobs.com OR site:bamboohr.com OR site:jobs.ashbyhq.com OR site:workable.com" },
  { id: "forms", focus: "startup and direct application forms", query: "internship India site:tally.so OR site:typeform.com OR site:fillout.com OR site:forms.gle" },
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
    .replace(/\s*[|–—-]\s*(LinkedIn|Glassdoor|Internshala|Indeed|Wellfound|Unstop)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function domainLabel(hostname: string) {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".");
  const meaningful = parts.filter((part) => !["jobs", "careers", "job", "www"].includes(part));
  return meaningful[0] || hostname.toLowerCase();
}

function inferCompanyAndTitle(result: BraveSearchResult, platformId: string) {
  const title = cleanTitle(result.title);
  if (platformId === "linkedin") {
    const match = title.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+.+$/i);
    if (match) return { company: match[1].trim().slice(0, 200), title: match[2].trim().slice(0, 300) };
  }
  if (platformId === "internshala") {
    const match = title.match(/^(.+?)\s+Internship\s+at\s+(.+)$/i);
    if (match) return { company: match[2].trim().slice(0, 200), title: `${match[1].trim()} Internship`.slice(0, 300) };
  }
  const url = new URL(result.url);
  return { company: domainLabel(url.hostname), title: title || "Internship opportunity" };
}

function inferLocation(text: string) {
  const matches = text.match(/\b(Remote|India|Bengaluru|Bangalore|Chennai|Hyderabad|Noida|Gurugram|Gurgaon|Mumbai|Delhi|Pune|Kolkata)\b/gi) ?? [];
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
  const inferred = inferCompanyAndTitle(result, platform.id);
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

  const deduped = [...new Map(leads.map((lead) => [lead.canonicalUrl, lead])).values()].slice(0, 60);
  return { enabled: true, leads: deduped, failures };
}
