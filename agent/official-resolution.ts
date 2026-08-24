import { AshbyAdapter, GreenhouseAdapter, LeverAdapter, SmartRecruitersAdapter, WorkablePublicAdapter } from "../lib/adapters.ts";
import { BambooHrPublicCareersAdapter } from "../lib/bamboohr-adapter.ts";
import { RecruiteePublicCareersAdapter } from "../lib/recruitee-adapter.ts";
import { parseTeamtailorPublicJobUrl, TeamtailorOfficialPageAdapter } from "../lib/teamtailor-adapter.ts";
import { WorkdayPublicCxsAdapter } from "../lib/workday-adapter.ts";
import type { BraveSearchResult } from "../lib/scout/brave-search.ts";
import { snapshotHash } from "../lib/scout/sync.ts";
import type { AtsProvider } from "../lib/scout/types.ts";
import { parseWorkdayPublicUrl } from "../lib/scout/workday-source.ts";
import { resolveOfficialCompanyDomain } from "./company-domain-resolution.ts";
import { createAgentSearchProvider } from "./search-runtime.ts";

export const OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES = Object.freeze({
  serverDerivedQueriesOnly: true,
  greenhouse: true,
  lever: true,
  ashby: true,
  workable: true,
  smartrecruiters: true,
  workday: true,
  bamboohr: true,
  recruitee: true,
  teamtailor: true,
  refetchOfficialAts: true,
  workdayTenantGuessing: false,
  bamboohrTenantGuessing: false,
  bamboohrEmployerApiCredentials: false,
  recruiteeTenantGuessing: false,
  recruiteeCareersApiToken: false,
  teamtailorTenantGuessing: false,
  teamtailorApiKey: false,
  teamtailorCustomDomainGuessing: false,
  resolveCompanyDomainFromConvergingEvidence: true,
  searchPersistenceGateRequired: true,
  arbitraryResultPageFetch: false,
  linkedinScrape: false,
  companyDomainGuessing: false,
  submitApplication: false,
  sendEmail: false,
} as const);

type SearchProvider = {
  allowResultPersistence?: boolean;
  searchFixedQuery(query: string): Promise<BraveSearchResult[]>;
};

type ObservedJob = Awaited<ReturnType<GreenhouseAdapter["discover"]>>[number];
type DomainResolution = Awaited<ReturnType<typeof resolveOfficialCompanyDomain>>;

type ResolutionDependencies = {
  searchProvider?: SearchProvider | null;
  discover?: (provider: AtsProvider, slug: string, externalId: string) => Promise<ObservedJob[]>;
  resolveCompanyDomain?: (company: string, searchProvider: SearchProvider) => Promise<DomainResolution>;
};

const GENERIC_ROLE_WORDS = new Set(["intern", "internship", "trainee", "apprentice", "role", "job", "position", "opening"]);
const GENERIC_COMPANY_WORDS = new Set(["private", "limited", "ltd", "inc", "llc", "company", "technologies", "technology", "solutions", "india"]);
const SMARTRECRUITERS_POSTING_SEGMENT = /^([0-9]{4,32})(?:-|$)/;
const BAMBOOHR_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.bamboohr\.com$/i;
const RECRUITEE_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.recruitee\.com$/i;

function compact(value: string, max: number) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[^\p{L}\p{N} .&+/_-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function tokens(value: string, ignored: Set<string>) {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length >= 3 && !ignored.has(token));
}

function tokenOverlap(expected: string[], observed: string[]) {
  if (!expected.length) return 1;
  const actual = new Set(observed);
  return expected.filter((token) => actual.has(token)).length / expected.length;
}

function parseSupportedAtsUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if ((host === "job-boards.greenhouse.io" || host === "boards.greenhouse.io") && parts.length === 3 && parts[1] === "jobs") {
    return { provider: "greenhouse" as const, slug: parts[0], externalId: parts[2] };
  }
  if (host === "jobs.lever.co" && parts.length === 2) {
    return { provider: "lever" as const, slug: parts[0], externalId: parts[1] };
  }
  if (host === "jobs.ashbyhq.com" && parts.length === 2) {
    return { provider: "ashby" as const, slug: parts[0], externalId: parts[1] };
  }
  if (host === "apply.workable.com" && parts.length === 3 && parts[1] === "j") {
    return { provider: "workable" as const, slug: parts[0], externalId: parts[2] };
  }
  if (host === "jobs.smartrecruiters.com" && parts.length === 2) {
    const match = parts[1].match(SMARTRECRUITERS_POSTING_SEGMENT);
    if (match) return { provider: "smartrecruiters" as const, slug: parts[0], externalId: match[1] };
  }
  if (host.endsWith(".myworkdayjobs.com") || host.endsWith(".myworkdaysite.com")) {
    try {
      const workday = parseWorkdayPublicUrl(url.href);
      if (workday.externalPath) return { provider: "workday" as const, slug: workday.boardToken, externalId: workday.externalPath };
    } catch {
      return null;
    }
  }
  if (host.endsWith(".teamtailor.com")) {
    try {
      const teamtailor = parseTeamtailorPublicJobUrl(url.href);
      return { provider: "teamtailor" as const, slug: teamtailor.tenant, externalId: teamtailor.externalId };
    } catch {
      return null;
    }
  }
  const bamboo = host.match(BAMBOOHR_HOST_PATTERN);
  if (bamboo && parts.length === 2 && parts[0] === "careers") {
    try {
      const externalId = decodeURIComponent(parts[1]);
      if (/^[A-Za-z0-9_-]{1,80}$/.test(externalId)) return { provider: "bamboohr" as const, slug: bamboo[1].toLowerCase(), externalId };
    } catch {
      return null;
    }
  }
  const recruitee = host.match(RECRUITEE_HOST_PATTERN);
  if (recruitee && parts.length === 2 && parts[0] === "o") {
    try {
      const externalId = decodeURIComponent(parts[1]);
      if (/^[A-Za-z0-9_-]{1,180}$/.test(externalId)) return { provider: "recruitee" as const, slug: recruitee[1].toLowerCase(), externalId };
    } catch {
      return null;
    }
  }
  return null;
}

function companyEvidenceMatches(company: string, candidate: BraveSearchResult, slug: string) {
  const expected = tokens(company, GENERIC_COMPANY_WORDS);
  if (!expected.length) return false;
  const haystack = tokens(`${candidate.title} ${candidate.description} ${slug.replace(/[-_/]/g, " ")}`, GENERIC_COMPANY_WORDS);
  return tokenOverlap(expected, haystack) >= Math.min(1, expected.length === 1 ? 1 : 0.5);
}

function roleEvidenceMatches(expectedTitle: string, observedTitle: string) {
  const expected = tokens(expectedTitle, GENERIC_ROLE_WORDS);
  const observed = tokens(observedTitle, GENERIC_ROLE_WORDS);
  return tokenOverlap(expected, observed) >= 0.5;
}

async function defaultDiscover(provider: AtsProvider, slug: string, externalId: string) {
  switch (provider) {
    case "greenhouse": return new GreenhouseAdapter().discover(slug);
    case "lever": return new LeverAdapter().discover(slug);
    case "ashby": return new AshbyAdapter().discover(slug);
    case "workable": return new WorkablePublicAdapter().discover(slug);
    case "smartrecruiters": {
      const job = await new SmartRecruitersAdapter().discoverPosting(slug, externalId);
      return job ? [job] : [];
    }
    case "workday": {
      const job = await new WorkdayPublicCxsAdapter().discoverPosting(slug, externalId);
      return job ? [job] : [];
    }
    case "bamboohr": {
      const job = await new BambooHrPublicCareersAdapter().discoverPosting(slug, externalId);
      return job ? [job] : [];
    }
    case "recruitee": {
      const job = await new RecruiteePublicCareersAdapter().discoverPosting(slug, externalId);
      return job ? [job] : [];
    }
    case "teamtailor": {
      const job = await new TeamtailorOfficialPageAdapter().discoverPosting(slug, externalId);
      return job ? [job] : [];
    }
  }
}

function searchQueries(company: string, title: string) {
  const safeCompany = compact(company, 120);
  const safeTitle = compact(title, 180);
  if (!safeCompany || !safeTitle) throw new Error("Lead company and title are required for official-source resolution");
  return [
    `"${safeCompany}" "${safeTitle}" site:job-boards.greenhouse.io`,
    `"${safeCompany}" "${safeTitle}" site:jobs.lever.co`,
    `"${safeCompany}" "${safeTitle}" site:jobs.ashbyhq.com`,
    `"${safeCompany}" "${safeTitle}" site:apply.workable.com`,
    `"${safeCompany}" "${safeTitle}" site:jobs.smartrecruiters.com`,
    `"${safeCompany}" "${safeTitle}" site:myworkdayjobs.com OR site:myworkdaysite.com`,
    `"${safeCompany}" "${safeTitle}" (site:bamboohr.com/careers OR site:recruitee.com/o/ OR site:teamtailor.com/jobs/)`,
  ];
}

function atsCareersUrl(provider: AtsProvider, slug: string) {
  switch (provider) {
    case "greenhouse": return `https://job-boards.greenhouse.io/${slug}`;
    case "lever": return `https://jobs.lever.co/${slug}`;
    case "ashby": return `https://jobs.ashbyhq.com/${slug}`;
    case "workable": return `https://apply.workable.com/${slug}/`;
    case "smartrecruiters": return `https://careers.smartrecruiters.com/${slug}`;
    case "workday": return `https://${slug}`;
    case "bamboohr": return `https://${slug}.bamboohr.com/careers`;
    case "recruitee": return `https://${slug}.recruitee.com/`;
    case "teamtailor": return `https://${slug}.teamtailor.com/jobs`;
  }
}

function resolvedSourceId(provider: AtsProvider, slug: string) {
  const safe = slug.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `resolved-${provider}-${safe}`.slice(0, 200);
}

export async function resolveSearchLeadToOfficialAts(input: {
  leadUrl: string;
  company: string;
  title: string;
}, dependencies: ResolutionDependencies = {}) {
  const provider = dependencies.searchProvider === undefined ? createAgentSearchProvider() : dependencies.searchProvider;
  if (!provider) throw new Error("Official-source web search is not configured");
  if (provider.allowResultPersistence === false) {
    throw new Error("Official ATS search evidence cannot be persisted until search result persistence is explicitly allowed");
  }
  const discover = dependencies.discover ?? defaultDiscover;
  const resolveCompanyDomain = dependencies.resolveCompanyDomain ?? resolveOfficialCompanyDomain;
  const queries = searchQueries(input.company, input.title);
  const results = (await Promise.all(queries.map((query) => provider.searchFixedQuery(query)))).flat().slice(0, 100);

  for (const result of results) {
    const parsed = parseSupportedAtsUrl(result.url);
    if (!parsed || !companyEvidenceMatches(input.company, result, parsed.slug)) continue;
    let jobs: ObservedJob[];
    try { jobs = await discover(parsed.provider, parsed.slug, parsed.externalId); }
    catch { continue; }
    const observed = jobs.find((job) => job.externalId === parsed.externalId);
    if (!observed || !roleEvidenceMatches(input.title, observed.title)) continue;
    const observedParsed = parseSupportedAtsUrl(observed.canonicalUrl);
    if (!observedParsed || observedParsed.provider !== parsed.provider || observedParsed.slug !== parsed.slug || observedParsed.externalId !== parsed.externalId) continue;

    const snapshot = {
      sourceProvider: parsed.provider,
      externalId: observed.externalId,
      canonicalUrl: observed.canonicalUrl,
      company: compact(input.company, 200),
      title: observed.title,
      description: observed.description,
      location: observed.location,
      workplaceType: observed.workplaceType,
      score: 0,
      scoreExplanation: ["Unranked: application review uses approved candidate claims"],
      eligibilityRisks: [] as string[],
      postedAt: observed.postedAt ?? null,
    };

    let companyDomain: DomainResolution = null;
    try { companyDomain = await resolveCompanyDomain(snapshot.company, provider); }
    catch {
      // ATS resolution is still useful when domain evidence is unavailable. Contact research remains disabled.
    }

    return {
      source: {
        id: resolvedSourceId(parsed.provider, parsed.slug),
        provider: parsed.provider,
        companyName: snapshot.company,
        boardToken: parsed.slug,
        companyDomain: companyDomain?.domain ?? "unresolved.invalid",
        careersUrl: companyDomain?.careersUrl ?? atsCareersUrl(parsed.provider, parsed.slug),
        enabled: true as const,
      },
      snapshot,
      contentHash: await snapshotHash(snapshot),
      resolutionEvidence: {
        originalLeadUrl: input.leadUrl,
        searchResultUrl: result.url,
        searchResultTitle: result.title,
        companyDomainResolved: Boolean(companyDomain),
        companyDomain: companyDomain?.domain ?? null,
        companyDomainEvidence: companyDomain?.evidence ?? [],
      },
    };
  }

  throw new Error("No sufficiently matched official Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, or BambooHR posting was found; no Recruitee or Teamtailor posting matched either.");
}