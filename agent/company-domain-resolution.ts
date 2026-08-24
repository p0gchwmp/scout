import type { BraveSearchResult } from "../lib/scout/brave-search.ts";

export const COMPANY_DOMAIN_RESOLUTION_CAPABILITIES = Object.freeze({
  serverDerivedQueriesOnly: true,
  requiresConvergingSearchEvidence: true,
  excludesJobBoardsAndSocialPlatforms: true,
  searchPersistenceGateRequired: true,
  companyDomainGuessing: false,
  arbitraryPageFetch: false,
  contactResearch: false,
  sendEmail: false,
  submitApplication: false,
} as const);

type SearchProvider = {
  allowResultPersistence?: boolean;
  searchFixedQuery(query: string): Promise<BraveSearchResult[]>;
};

const GENERIC_COMPANY_WORDS = new Set([
  "private", "limited", "ltd", "inc", "llc", "company", "technologies", "technology",
  "solutions", "services", "group", "holdings", "india", "global", "labs", "systems",
]);

const MULTIPART_PUBLIC_SUFFIXES = new Set([
  "co.in", "org.in", "net.in", "firm.in", "gen.in", "ind.in",
  "co.uk", "org.uk", "me.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "org.nz",
  "com.sg", "com.hk", "com.my", "co.jp", "co.kr", "com.br", "com.mx",
]);

const BLOCKED_DOMAINS = [
  "linkedin.com", "glassdoor.com", "glassdoor.co.in", "indeed.com", "indeed.co.in", "naukri.com",
  "internshala.com", "wellfound.com", "unstop.com", "cutshort.io", "foundit.in",
  "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com",
  "myworkdayjobs.com", "myworkdaysite.com", "bamboohr.com", "icims.com", "jobvite.com",
  "recruitee.com", "teamtailor.com", "breezy.hr", "applytojob.com", "pinpointhq.com",
  "personio.com", "rippling.com", "freshteam.com", "zohorecruit.com", "oraclecloud.com",
  "successfactors.com", "taleo.net", "adp.com", "eightfold.ai", "phenompeople.com", "avature.net",
  "tally.so", "typeform.com", "fillout.com", "jotform.com", "forms.gle", "google.com", "microsoft.com",
  "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "wikipedia.org",
  "crunchbase.com", "github.com", "medium.com", "reddit.com",
] as const;

function compact(value: string, max: number) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[^\p{L}\p{N} .&+/_-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function tokens(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length >= 3 && !GENERIC_COMPANY_WORDS.has(token));
}

function tokenOverlap(expected: string[], observed: string[]) {
  if (!expected.length) return 0;
  const actual = new Set(observed);
  return expected.filter((token) => actual.has(token)).length / expected.length;
}

function isIpLike(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function registrableDomain(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || isIpLike(host)) return null;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join(".");
  const domain = MULTIPART_PUBLIC_SUFFIXES.has(lastTwo) && labels.length >= 3
    ? labels.slice(-3).join(".")
    : lastTwo;
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) return null;
  return domain;
}

function blockedDomain(domain: string) {
  return BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function candidateFromResult(company: string, result: BraveSearchResult) {
  let url: URL;
  try { url = new URL(result.url); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const domain = registrableDomain(url.hostname);
  if (!domain || blockedDomain(domain)) return null;

  const expected = tokens(company);
  if (!expected.length) return null;
  const evidenceTokens = tokens(`${result.title} ${result.description} ${url.hostname.replace(/[.-]/g, " ")}`);
  const domainTokens = tokens(domain.replace(/[.-]/g, " "));
  const evidenceOverlap = tokenOverlap(expected, evidenceTokens);
  const domainOverlap = tokenOverlap(expected, domainTokens);
  if (evidenceOverlap < (expected.length === 1 ? 1 : 0.5)) return null;
  if (domainOverlap === 0 && evidenceOverlap < 1) return null;

  return {
    domain,
    url: url.href,
    title: compact(result.title, 500),
    description: compact(result.description, 1200),
    careersLike: /career|job|join|work with|opportunit|vacan/i.test(`${url.pathname} ${result.title} ${result.description}`),
  };
}

function queries(company: string) {
  const safeCompany = compact(company, 120);
  if (!safeCompany) throw new Error("Company name is required for domain resolution");
  return [
    { id: "official", query: `"${safeCompany}" official website` },
    { id: "careers", query: `"${safeCompany}" careers jobs` },
  ] as const;
}

export async function resolveOfficialCompanyDomain(company: string, searchProvider: SearchProvider) {
  if (searchProvider.allowResultPersistence === false) {
    throw new Error("Official company-domain evidence cannot be persisted until search result persistence is explicitly allowed");
  }
  const planned = queries(company);
  const settled = await Promise.all(planned.map(async (plan) => ({
    plan,
    results: await searchProvider.searchFixedQuery(plan.query),
  })));

  const evidenceByDomain = new Map<string, Array<{
    queryId: string;
    url: string;
    title: string;
    description: string;
    careersLike: boolean;
  }>>();

  for (const group of settled) {
    const seenForQuery = new Set<string>();
    for (const result of group.results.slice(0, 20)) {
      const candidate = candidateFromResult(company, result);
      if (!candidate || seenForQuery.has(candidate.domain)) continue;
      seenForQuery.add(candidate.domain);
      const current = evidenceByDomain.get(candidate.domain) ?? [];
      current.push({ queryId: group.plan.id, ...candidate });
      evidenceByDomain.set(candidate.domain, current);
    }
  }

  const converged = [...evidenceByDomain.entries()]
    .filter(([, evidence]) => new Set(evidence.map((item) => item.queryId)).size >= 2)
    .sort((left, right) => {
      const leftCareer = left[1].some((item) => item.careersLike) ? 1 : 0;
      const rightCareer = right[1].some((item) => item.careersLike) ? 1 : 0;
      return rightCareer - leftCareer || right[1].length - left[1].length || left[0].localeCompare(right[0]);
    });

  if (!converged.length) return null;
  if (converged.length > 1) {
    const [first, second] = converged;
    const firstScore = (first[1].some((item) => item.careersLike) ? 10 : 0) + first[1].length;
    const secondScore = (second[1].some((item) => item.careersLike) ? 10 : 0) + second[1].length;
    if (firstScore === secondScore) return null;
  }

  const [domain, evidence] = converged[0];
  const careersEvidence = evidence.find((item) => item.careersLike) ?? evidence[0];
  return {
    domain,
    careersUrl: careersEvidence.url,
    evidence: evidence.map(({ queryId, url, title, description }) => ({ queryId, url, title, description })),
    confidence: "high" as const,
  };
}
