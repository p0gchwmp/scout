import { rankPublishedContacts } from "../lib/scout/contact-intelligence.ts";
import type { BraveSearchResult } from "../lib/scout/brave-search.ts";
import {
  OFFICIAL_CONTACT_CRAWL_SEEDS,
  classifyOfficialContactSource,
  isOfficialContactResearchLink,
  type OfficialContactSourceType,
} from "../lib/scout/contact-source-registry.ts";

const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi;
const OBFUSCATED_EMAIL_PATTERN = /\b([A-Z0-9._%+-]{2,80})\s*(?:\[at\]|\(at\)|\sat\s)\s*([A-Z0-9.-]{2,180})\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*([A-Z]{2,63})\b/gi;
const RECRUITING_CONTEXT_PATTERN = /\b(recruit(?:er|ing|ment)?|talent|hiring|careers?|campus|university recruiting|early careers?|internships?|career fair|human resources?|\bhr\b)\b/i;
const GENERIC_RECRUITING_OR_BUSINESS_LOCAL = /^(?:careers?|jobs?|recruit(?:er|ing|ment)?|talent(?:acquisition)?|hiring|hr|people(?:ops|team)?|internships?|campus|early[-_.]?careers?|contact|hello|info|office|team|general|enquir(?:y|ies)|inquir(?:y|ies))(?:[._+-][a-z0-9-]+)?$/i;
const WRONG_PURPOSE_LOCAL = /^(?:press|media|pr|sales|support|billing|privacy|security|legal|investors?|fundraising|pitch|deals?|lp|procurement|vendor)(?:[._+-]|$)/i;
const WRONG_PURPOSE_CONTEXT_PATTERN = /\b(?:report(?:ing)?(?:\s+(?:a|an|the))?\s+(?:scam|fraud|phishing|suspicious (?:message|email|recruiter|communication)|security (?:issue|incident|vulnerability))|suspected fraud|recruitment scam|recruiting scam|phishing|security vulnerability|security incident|privacy request|data subject request|data protection request|copyright complaint|dmca notice|accessibility-only|accessibility support)\b/i;
const EXPLICIT_RECRUITING_ACTION_PATTERN = /\b(?:apply|application|submit (?:your )?resume|send (?:your )?resume|candidate inquir(?:y|ies)|recruiting inquir(?:y|ies)|career opportunit(?:y|ies)|job opportunit(?:y|ies)|internship opportunit(?:y|ies)|join our team)\b/i;
const MAX_FIRST_PARTY_PAGES = 12;
const MAX_PAGE_BYTES = 750_000;
const FETCH_TIMEOUT_MS = 8_000;
const MIN_FETCH_TIMEOUT_MS = 250;
const CONSUMER_EMAIL_HOSTS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com"]);
const DEADLINE_ERROR = "Contact research deadline reached";

export const CONTACT_RESEARCH_CAPABILITIES = Object.freeze({
  officialCompanyPagesFirst: true,
  registeredOfficialSourceTypes: true,
  officialJobPostingPages: true,
  officialTeamPages: true,
  officialEventPages: true,
  officialPressPages: true,
  broaderPublicRecruitingEvidence: false,
  thirdPartyPublicPageFetch: false,
  companyDomainBoundFirstParty: true,
  verifiedCareersSeedSupported: true,
  deterministicExtraction: true,
  deterministicRecruitingRanking: true,
  wrongPurposeContextRejected: true,
  aiClassificationInputReady: true,
  namedBusinessMailboxRequiresRecruitingContext: true,
  linkedinLeadClueOnly: true,
  guessEmail: false,
  linkedinScrape: false,
  dataBrokerLookup: false,
  personalDataHarvest: false,
} as const);

export type ContactSourceContext = "first_party" | "official_event" | "university_career" | "official_press" | "public_recruiting";

export type PublishedContactResearchCandidate = {
  id: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType: OfficialContactSourceType;
  sourceContext?: ContactSourceContext;
};

export type PublicSearchProvider = {
  provider: string;
  searchFixedQuery(query: string, options?: { timeoutMs?: number }): Promise<BraveSearchResult[]>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function normalizeDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^www\./, "");
  if (!DOMAIN_PATTERN.test(domain) || domain.endsWith(".local") || domain.endsWith(".internal")) throw new Error("Company domain is invalid");
  return domain;
}

function officialHost(hostname: string, domain: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === domain || host.endsWith(`.${domain}`);
}

function safeOfficialUrl(raw: string, domain: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Official company URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !officialHost(url.hostname, domain)) {
    throw new Error("Official company URL escaped the registered company domain");
  }
  url.hash = "";
  return url;
}

function decodeText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/\s+/g, " ")
    .trim();
}

async function candidateId(email: string, sourceUrl: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${email}\n${sourceUrl}`));
  const short = Array.from(new Uint8Array(digest).slice(0, 12), (value) => value.toString(16).padStart(2, "0")).join("");
  return `published-${short}`;
}

function excerptAround(text: string, email: string) {
  const index = text.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) return text.slice(0, 380).trim() || email;
  const start = Math.max(0, index - 150);
  const end = Math.min(text.length, index + email.length + 190);
  return text.slice(start, end).trim();
}

function extractEmails(text: string) {
  const found = new Set((text.match(EMAIL_PATTERN) ?? []).map((email) => email.toLowerCase().replace(/[.,;:!?]+$/, "")));
  for (const match of text.matchAll(OBFUSCATED_EMAIL_PATTERN)) found.add(`${match[1]}@${match[2]}.${match[3]}`.toLowerCase());
  return [...found];
}

function clauseAroundEmail(text: string, email: string) {
  const index = text.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) return "";
  const before = text.slice(Math.max(0, index - 180), index);
  const after = text.slice(index + email.length, Math.min(text.length, index + email.length + 100));
  const leftBoundary = Math.max(before.lastIndexOf("."), before.lastIndexOf(";"), before.lastIndexOf("|"), before.lastIndexOf("•"));
  const rightCandidates = [after.indexOf("."), after.indexOf(";"), after.indexOf("|"), after.indexOf("•")].filter((value) => value >= 0);
  const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : after.length;
  return `${before.slice(leftBoundary + 1)} ${email} ${after.slice(0, rightBoundary)}`.trim();
}

function businessEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase().replace(/^www\./, "") ?? "";
  return Boolean(domain && DOMAIN_PATTERN.test(domain) && !CONSUMER_EMAIL_HOSTS.has(domain));
}

function firstPartyMailboxAllowed(email: string, excerpt: string) {
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (!localPart || WRONG_PURPOSE_LOCAL.test(localPart)) return false;
  const context = `${localPart} ${excerpt}`;
  if (WRONG_PURPOSE_CONTEXT_PATTERN.test(excerpt) && !EXPLICIT_RECRUITING_ACTION_PATTERN.test(excerpt)) return false;
  if (GENERIC_RECRUITING_OR_BUSINESS_LOCAL.test(localPart)) return true;
  return RECRUITING_CONTEXT_PATTERN.test(context);
}

function extractOfficialLinks(html: string, base: URL, domain: string) {
  const links: URL[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = safeOfficialUrl(new URL(match[1], base).toString(), domain);
      if (!isOfficialContactResearchLink(url)) continue;
      links.push(url);
    } catch {
      // External, malformed, non-HTTPS and off-domain links are intentionally ignored.
    }
  }
  return links;
}

function positiveInteger(value: number | undefined, fallback: number, min: number, max: number, label: string) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} is invalid`);
  return value;
}

function fetchTimeout(deadlineAt: number, now: () => number, capMs: number) {
  if (!Number.isFinite(deadlineAt)) return capMs;
  const remaining = Math.floor(deadlineAt - now());
  if (remaining < MIN_FETCH_TIMEOUT_MS) throw new Error(DEADLINE_ERROR);
  return Math.min(capMs, remaining);
}

async function fetchTextPage(initial: URL, fetcher: FetchLike, officialDomain: string, deadlineAt: number, now: () => number, pageTimeoutMs: number) {
  let current = initial;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const timeoutMs = fetchTimeout(deadlineAt, now, pageTimeoutMs);
    const response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "text/html,text/plain;q=0.9" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Official page redirect was missing a location");
      current = safeOfficialUrl(new URL(location, current).toString(), officialDomain);
      continue;
    }
    if (!response.ok) throw new Error(`Official page returned ${response.status}`);
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (type && !type.includes("text/html") && !type.includes("text/plain")) throw new Error("Official page was not text content");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PAGE_BYTES) throw new Error("Official page exceeded the research size limit");
    return { url: current, html: new TextDecoder().decode(buffer) };
  }
  throw new Error("Official page redirected too many times");
}

export async function researchPublishedCompanyContacts(input: {
  companyDomain: string;
  jobSnapshotId: string;
  companyName?: string | null;
  careersUrl?: string | null;
  searchProvider?: PublicSearchProvider | null;
  fetcher?: FetchLike;
  deadlineAt?: number;
  maxPages?: number;
  pageTimeoutMs?: number;
  now?: () => number;
}) {
  const domain = normalizeDomain(input.companyDomain);
  const jobSnapshotId = input.jobSnapshotId.trim();
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(jobSnapshotId)) throw new Error("Job snapshot id is invalid");
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? Date.now;
  const maxPages = positiveInteger(input.maxPages, MAX_FIRST_PARTY_PAGES, 1, MAX_FIRST_PARTY_PAGES, "Contact research page limit");
  const pageTimeoutMs = positiveInteger(input.pageTimeoutMs, FETCH_TIMEOUT_MS, MIN_FETCH_TIMEOUT_MS, FETCH_TIMEOUT_MS, "Contact research page timeout");
  const deadlineAt = input.deadlineAt ?? Number.POSITIVE_INFINITY;
  if (Number.isNaN(deadlineAt) || deadlineAt <= 0) throw new Error("Contact research deadline is invalid");

  const queue: URL[] = [];
  if (input.careersUrl) queue.push(safeOfficialUrl(input.careersUrl, domain));
  queue.push(...OFFICIAL_CONTACT_CRAWL_SEEDS.map((path) => new URL(path, `https://${domain}`)));
  const visited = new Set<string>();
  const failures: Array<{ sourceUrl: string; reason: string }> = [];
  const candidates = new Map<string, PublishedContactResearchCandidate>();
  let deferredDueToTime = false;

  while (queue.length && visited.size < maxPages) {
    if (Number.isFinite(deadlineAt) && deadlineAt - now() < MIN_FETCH_TIMEOUT_MS) {
      deferredDueToTime = true;
      break;
    }
    const proposed = queue.shift()!;
    let safe: URL;
    try { safe = safeOfficialUrl(proposed.toString(), domain); } catch { continue; }
    if (visited.has(safe.href)) continue;
    visited.add(safe.href);
    try {
      const page = await fetchTextPage(safe, fetcher, domain, deadlineAt, now, pageTimeoutMs);
      const text = decodeText(page.html);
      for (const email of extractEmails(text)) {
        const emailDomain = email.split("@")[1]?.replace(/^www\./, "") ?? "";
        if (!businessEmail(email) || !officialHost(emailDomain, domain)) continue;
        const excerpt = excerptAround(text, email);
        if (!firstPartyMailboxAllowed(email, clauseAroundEmail(text, email))) continue;
        const sourceUrl = page.url.href;
        const id = await candidateId(email, sourceUrl);
        candidates.set(`${email}|${sourceUrl}`, { id, email, sourceUrl, excerpt, sourceType: classifyOfficialContactSource(page.url), sourceContext: "first_party" });
      }
      for (const link of extractOfficialLinks(page.html, page.url, domain)) {
        if (!visited.has(link.href) && queue.length + visited.size < maxPages * 3) queue.push(link);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Official page fetch failed";
      if (message === DEADLINE_ERROR || (Number.isFinite(deadlineAt) && deadlineAt - now() < MIN_FETCH_TIMEOUT_MS)) {
        deferredDueToTime = true;
        break;
      }
      failures.push({ sourceUrl: safe.href, reason: message.slice(0, 180) });
    }
  }

  return {
    schemaVersion: 1 as const,
    jobSnapshotId,
    companyDomain: domain,
    researchedAt: new Date().toISOString(),
    pagesAttempted: visited.size,
    firstPartyPagesAttempted: visited.size,
    publicPagesAttempted: 0,
    searchQueriesAttempted: 0,
    deferredDueToTime,
    candidates: rankPublishedContacts([...candidates.values()]).slice(0, 50),
    failures: failures.slice(0, maxPages),
  };
}
