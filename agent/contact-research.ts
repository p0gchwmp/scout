const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi;
const RELEVANT_LINK_PATTERN = /(?:career|job|join|contact|recruit|talent|people|team|about)/i;
const MAX_PAGES = 8;
const MAX_PAGE_BYTES = 750_000;
const FETCH_TIMEOUT_MS = 8_000;

export const CONTACT_RESEARCH_CAPABILITIES = Object.freeze({
  officialCompanyPagesOnly: true,
  companyDomainBound: true,
  verifiedCareersSeedSupported: true,
  deterministicExtraction: true,
  aiClassificationInputReady: true,
  guessEmail: false,
  linkedinScrape: false,
  personalDataHarvest: false,
  sendEmail: false,
} as const);

export type PublishedContactResearchCandidate = {
  id: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType: "official_careers" | "official_contact" | "official_company";
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

function sourceType(url: URL): PublishedContactResearchCandidate["sourceType"] {
  const hostAndPath = `${url.hostname}${url.pathname}`;
  if (/career|job|join|recruit|talent/i.test(hostAndPath)) return "official_careers";
  if (/contact/i.test(hostAndPath)) return "official_contact";
  return "official_company";
}

async function candidateId(email: string, sourceUrl: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${email}\n${sourceUrl}`));
  const short = Array.from(new Uint8Array(digest).slice(0, 12), (value) => value.toString(16).padStart(2, "0")).join("");
  return `published-${short}`;
}

function excerptAround(text: string, email: string) {
  const index = text.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) return email;
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + email.length + 160);
  return text.slice(start, end).trim();
}

function extractOfficialLinks(html: string, base: URL, domain: string) {
  const links: URL[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = safeOfficialUrl(new URL(match[1], base).toString(), domain);
      if (!RELEVANT_LINK_PATTERN.test(`${url.pathname}${url.search}`)) continue;
      links.push(url);
    } catch {
      // External, malformed, non-HTTPS and off-domain links are intentionally ignored.
    }
  }
  return links;
}

async function fetchOfficialPage(url: URL, domain: string, fetcher: FetchLike) {
  let current = url;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetcher(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "accept": "text/html,text/plain;q=0.9" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Official company page redirect was missing a location");
      current = safeOfficialUrl(new URL(location, current).toString(), domain);
      continue;
    }
    if (!response.ok) throw new Error(`Official company page returned ${response.status}`);
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (type && !type.includes("text/html") && !type.includes("text/plain")) throw new Error("Official company page was not text content");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PAGE_BYTES) throw new Error("Official company page exceeded the research size limit");
    return { url: current, html: new TextDecoder().decode(buffer) };
  }
  throw new Error("Official company page redirected too many times");
}

export async function researchPublishedCompanyContacts(input: {
  companyDomain: string;
  jobSnapshotId: string;
  careersUrl?: string | null;
  fetcher?: FetchLike;
}) {
  const domain = normalizeDomain(input.companyDomain);
  const jobSnapshotId = input.jobSnapshotId.trim();
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(jobSnapshotId)) throw new Error("Job snapshot id is invalid");
  const fetcher = input.fetcher ?? fetch;
  const queue: URL[] = [];
  if (input.careersUrl) queue.push(safeOfficialUrl(input.careersUrl, domain));
  queue.push(...["/", "/careers", "/jobs", "/contact", "/contact-us"].map((path) => new URL(path, `https://${domain}`)));
  const visited = new Set<string>();
  const failures: Array<{ sourceUrl: string; reason: string }> = [];
  const candidates = new Map<string, PublishedContactResearchCandidate>();

  while (queue.length && visited.size < MAX_PAGES) {
    const proposed = queue.shift()!;
    let safe: URL;
    try { safe = safeOfficialUrl(proposed.toString(), domain); }
    catch { continue; }
    if (visited.has(safe.href)) continue;
    visited.add(safe.href);

    try {
      const page = await fetchOfficialPage(safe, domain, fetcher);
      const text = decodeText(page.html);
      for (const rawEmail of text.match(EMAIL_PATTERN) ?? []) {
        const email = rawEmail.toLowerCase().replace(/[.,;:!?]+$/, "");
        const emailDomain = email.split("@")[1]?.replace(/^www\./, "") ?? "";
        if (!officialHost(emailDomain, domain)) continue;
        const sourceUrl = page.url.href;
        const id = await candidateId(email, sourceUrl);
        candidates.set(`${email}|${sourceUrl}`, {
          id,
          email,
          sourceUrl,
          excerpt: excerptAround(text, email),
          sourceType: sourceType(page.url),
        });
      }
      for (const link of extractOfficialLinks(page.html, page.url, domain)) {
        if (!visited.has(link.href) && queue.length + visited.size < MAX_PAGES * 3) queue.push(link);
      }
    } catch (error) {
      failures.push({ sourceUrl: safe.href, reason: error instanceof Error ? error.message.slice(0, 180) : "Official page fetch failed" });
    }
  }

  return {
    schemaVersion: 1 as const,
    jobSnapshotId,
    companyDomain: domain,
    researchedAt: new Date().toISOString(),
    pagesAttempted: visited.size,
    candidates: [...candidates.values()].slice(0, 50),
    failures: failures.slice(0, MAX_PAGES),
  };
}
