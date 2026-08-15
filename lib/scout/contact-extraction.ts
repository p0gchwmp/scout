export type ContactSuitability = "high" | "review";
export type ContactReviewState = "needs_review" | "accepted" | "rejected";

export type ExtractedContact = {
  email: string;
  sourceUrl: string;
  excerpt: string;
  extractedAt: string;
  suitability: ContactSuitability;
  suitabilityReason: string;
  reviewState: ContactReviewState;
};

export type ContactRejection = {
  email: string;
  sourceUrl: string;
  reason: "consumer-domain" | "invalid-address";
};

const GREENHOUSE_HOSTS = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]);
const BOARD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{2,80}$/;
const EXTERNAL_ID_PATTERN = /^[0-9]+$/;
const COMPANY_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);
const EMAIL_PATTERN = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Greenhouse evidence URL has invalid encoding");
  }
}

export function validateGreenhouseEvidenceUrl(raw: string, boardToken: string, externalId: string) {
  if (!BOARD_TOKEN_PATTERN.test(boardToken)) throw new Error("Registered Greenhouse board token is invalid");
  if (!EXTERNAL_ID_PATTERN.test(externalId)) throw new Error("Greenhouse external id must be numeric");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Greenhouse evidence URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Greenhouse evidence URL must be an exact HTTPS job URL");
  }
  if (!GREENHOUSE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Greenhouse evidence URL host is not trusted");
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodePathSegment);
  if (parts.length !== 3 || parts[1] !== "jobs") {
    throw new Error("Greenhouse evidence URL path is invalid");
  }
  if (parts[0] !== boardToken) throw new Error("Greenhouse evidence URL board token does not match the registered source");
  if (parts[2] !== externalId) throw new Error("Greenhouse evidence URL external id does not match the job");
  return url;
}

function normalizedCompanyDomain(raw: string) {
  const domain = raw.trim().toLowerCase().replace(/^\./, "");
  if (!COMPANY_DOMAIN_PATTERN.test(domain)) throw new Error("Company domain is invalid");
  return domain;
}

function isFirstParty(hostname: string, companyDomain: string) {
  const domain = normalizedCompanyDomain(companyDomain);
  const candidate = hostname.toLowerCase();
  return candidate === domain || candidate.endsWith(`.${domain}`);
}

function contentToText(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function suitabilityFor(email: string, companyDomain: string): Pick<ExtractedContact, "suitability" | "suitabilityReason"> {
  const [local, domain] = email.split("@");
  if (/^(recruit(?:ing|ment)?|talent|careers?|jobs?|people|university|campus)([.+_-]|$)/i.test(local) && isFirstParty(domain, companyDomain)) {
    return { suitability: "high", suitabilityReason: "Published first-party recruiting address" };
  }
  return {
    suitability: "review",
    suitabilityReason: isFirstParty(domain, companyDomain)
      ? "Published first-party business address; role relevance needs review"
      : "Published business address; company relationship needs review",
  };
}

export function extractPublishedBusinessEmails(options: {
  persistedContent: string;
  evidenceUrl: string;
  boardToken: string;
  externalId: string;
  companyDomain: string;
  now?: () => string;
}) {
  if (options.persistedContent.length > 1_000_000) throw new Error("Persisted snapshot content exceeds extraction limit");
  const sourceUrl = validateGreenhouseEvidenceUrl(options.evidenceUrl, options.boardToken, options.externalId).href;
  normalizedCompanyDomain(options.companyDomain);
  const now = options.now ?? (() => new Date().toISOString());
  const text = contentToText(options.persistedContent);
  const contacts: ExtractedContact[] = [];
  const rejections: ContactRejection[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (CONSUMER_DOMAINS.has(domain)) {
      rejections.push({ email, sourceUrl, reason: "consumer-domain" });
      continue;
    }
    const index = match.index ?? 0;
    const excerpt = text.slice(Math.max(0, index - 80), Math.min(text.length, index + email.length + 80)).trim();
    contacts.push({
      email,
      sourceUrl,
      excerpt,
      extractedAt: now(),
      reviewState: "needs_review",
      ...suitabilityFor(email, options.companyDomain),
    });
  }
  return { contacts, rejections };
}
