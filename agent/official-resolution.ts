import { GreenhouseAdapter, LeverAdapter } from "../lib/adapters.ts";
import type { BraveSearchResult } from "../lib/scout/brave-search.ts";
import { snapshotHash } from "../lib/scout/sync.ts";
import { resolveOfficialCompanyDomain } from "./company-domain-resolution.ts";
import { createAgentSearchProvider } from "./search-runtime.ts";

export const OFFICIAL_SEARCH_RESOLUTION_CAPABILITIES = Object.freeze({
  serverDerivedQueriesOnly: true,
  greenhouse: true,
  lever: true,
  refetchOfficialAts: true,
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
  discover?: (provider: "greenhouse" | "lever", slug: string) => Promise<ObservedJob[]>;
  resolveCompanyDomain?: (company: string, searchProvider: SearchProvider) => Promise<DomainResolution>;
};

const GENERIC_ROLE_WORDS = new Set(["intern", "internship", "trainee", "apprentice", "role", "job", "position", "opening"]);
const GENERIC_COMPANY_WORDS = new Set(["private", "limited", "ltd", "inc", "llc", "company", "technologies", "technology", "solutions", "india"]);

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
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if ((host === "job-boards.greenhouse.io" || host === "boards.greenhouse.io") && parts.length >= 3 && parts[1] === "jobs") {
    return { provider: "greenhouse" as const, slug: parts[0], externalId: parts[2], url: `${url.origin}/${parts[0]}/jobs/${parts[2]}` };
  }
  if (host === "jobs.lever.co" && parts.length >= 2) {
    return { provider: "lever" as const, slug: parts[0], externalId: parts[1], url: `${url.origin}/${parts[0]}/${parts[1]}` };
  }
  return null;
}

function companyEvidenceMatches(company: string, candidate: BraveSearchResult, slug: string) {
  const expected = tokens(company, GENERIC_COMPANY_WORDS);
  if (!expected.length) return false;
  const haystack = tokens(`${candidate.title} ${candidate.description} ${slug.replace(/[-_]/g, " ")}`, GENERIC_COMPANY_WORDS);
  return tokenOverlap(expected, haystack) >= Math.min(1, expected.length === 1 ? 1 : 0.5);
}

function roleEvidenceMatches(expectedTitle: string, observedTitle: string) {
  const expected = tokens(expectedTitle, GENERIC_ROLE_WORDS);
  const observed = tokens(observedTitle, GENERIC_ROLE_WORDS);
  return tokenOverlap(expected, observed) >= 0.5;
}

async function defaultDiscover(provider: "greenhouse" | "lever", slug: string) {
  return provider === "greenhouse"
    ? new GreenhouseAdapter().discover(slug)
    : new LeverAdapter().discover(slug);
}

function searchQueries(company: string, title: string) {
  const safeCompany = compact(company, 120);
  const safeTitle = compact(title, 180);
  if (!safeCompany || !safeTitle) throw new Error("Lead company and title are required for official-source resolution");
  return [
    `"${safeCompany}" "${safeTitle}" site:job-boards.greenhouse.io`,
    `"${safeCompany}" "${safeTitle}" site:jobs.lever.co`,
  ];
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
  const results = (await Promise.all(queries.map((query) => provider.searchFixedQuery(query)))).flat().slice(0, 40);

  for (const result of results) {
    const parsed = parseSupportedAtsUrl(result.url);
    if (!parsed || !companyEvidenceMatches(input.company, result, parsed.slug)) continue;
    let jobs: ObservedJob[];
    try { jobs = await discover(parsed.provider, parsed.slug); }
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
    const atsCareersUrl = parsed.provider === "greenhouse"
      ? `https://job-boards.greenhouse.io/${parsed.slug}`
      : `https://jobs.lever.co/${parsed.slug}`;

    return {
      source: {
        id: `resolved-${parsed.provider}-${parsed.slug}`.slice(0, 200),
        provider: parsed.provider,
        companyName: snapshot.company,
        boardToken: parsed.slug,
        companyDomain: companyDomain?.domain ?? "unresolved.invalid",
        careersUrl: companyDomain?.careersUrl ?? atsCareersUrl,
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

  throw new Error("No sufficiently matched official Greenhouse or Lever posting was found for this lead");
}
