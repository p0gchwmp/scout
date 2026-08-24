import type { AtsProvider } from "./types";
import { normalizeWorkdayExternalPath, parseWorkdayBoardToken, parseWorkdayPublicUrl } from "./workday-source.ts";

export type ContactSuitability = "high" | "review";
export type ContactReviewState = "needs_review" | "accepted" | "rejected";
export type ContactSourceType = "official_job_posting" | "official_careers" | "official_contact" | "official_company" | "official_team" | "official_event" | "official_press";

export type ExtractedContact = {
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType: ContactSourceType;
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
const SOURCE_TOKEN_PATTERN = /^[A-Za-z0-9._-]{2,100}$/;
const EXTERNAL_ID_PATTERN = /^[0-9]+$/;
const COMPANY_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);
const EMAIL_PATTERN = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;

function decodePathSegment(value: string, provider = "ATS") {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${provider} evidence URL has invalid encoding`);
  }
}

function exactPublicJobUrl(raw: string, provider: string) {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error(`${provider} evidence URL is invalid`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error(`${provider} evidence URL must be an exact HTTPS job URL`);
  }
  return url;
}

export function validateGreenhouseEvidenceUrl(raw: string, boardToken: string, externalId: string) {
  if (!SOURCE_TOKEN_PATTERN.test(boardToken)) throw new Error("Registered Greenhouse board token is invalid");
  if (!EXTERNAL_ID_PATTERN.test(externalId)) throw new Error("Greenhouse external id must be numeric");

  const url = exactPublicJobUrl(raw, "Greenhouse");
  if (!GREENHOUSE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Greenhouse evidence URL host is not trusted");
  }
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodePathSegment(part, "Greenhouse"));
  if (parts.length !== 3 || parts[1] !== "jobs") {
    throw new Error("Greenhouse evidence URL path is invalid");
  }
  if (parts[0] !== boardToken) throw new Error("Greenhouse evidence URL board token does not match the registered source");
  if (parts[2] !== externalId) throw new Error("Greenhouse evidence URL external id does not match the job");
  return url;
}

const LEVER_HOST = "jobs.lever.co";
const LEVER_EXTERNAL_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export function validateLeverEvidenceUrl(raw: string, site: string, externalId: string) {
  if (!SOURCE_TOKEN_PATTERN.test(site)) throw new Error("Registered Lever site token is invalid");
  if (!LEVER_EXTERNAL_ID_PATTERN.test(externalId)) throw new Error("Lever external id is invalid");
  const url = exactPublicJobUrl(raw, "Lever");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodePathSegment(part, "Lever"));
  if (url.hostname.toLowerCase() !== LEVER_HOST || parts.length !== 2 || parts[0] !== site || parts[1] !== externalId) {
    throw new Error("Lever evidence URL does not match the registered source");
  }
  return url;
}

const ASHBY_HOST = "jobs.ashbyhq.com";
const ASHBY_EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{3,160}$/;

export function validateAshbyEvidenceUrl(raw: string, jobBoardName: string, externalId: string) {
  if (!SOURCE_TOKEN_PATTERN.test(jobBoardName)) throw new Error("Registered Ashby job-board name is invalid");
  if (!ASHBY_EXTERNAL_ID_PATTERN.test(externalId)) throw new Error("Ashby external id is invalid");
  const url = exactPublicJobUrl(raw, "Ashby");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodePathSegment(part, "Ashby"));
  if (url.hostname.toLowerCase() !== ASHBY_HOST || parts.length !== 2 || parts[0] !== jobBoardName || parts[1] !== externalId) {
    throw new Error("Ashby evidence URL does not match the registered source");
  }
  return url;
}

const WORKABLE_HOST = "apply.workable.com";
const WORKABLE_EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;

export function validateWorkableEvidenceUrl(raw: string, subdomain: string, externalId: string) {
  if (!SOURCE_TOKEN_PATTERN.test(subdomain)) throw new Error("Registered Workable account subdomain is invalid");
  if (!WORKABLE_EXTERNAL_ID_PATTERN.test(externalId)) throw new Error("Workable external id is invalid");
  const url = exactPublicJobUrl(raw, "Workable");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodePathSegment(part, "Workable"));
  if (url.hostname.toLowerCase() !== WORKABLE_HOST || parts.length !== 3 || parts[0] !== subdomain || parts[1] !== "j" || parts[2] !== externalId) {
    throw new Error("Workable evidence URL does not match the registered source");
  }
  return url;
}

const SMARTRECRUITERS_HOST = "jobs.smartrecruiters.com";
const SMARTRECRUITERS_EXTERNAL_ID_PATTERN = /^[0-9]{4,32}$/;

export function validateSmartRecruitersEvidenceUrl(raw: string, companyIdentifier: string, externalId: string) {
  if (!SOURCE_TOKEN_PATTERN.test(companyIdentifier)) throw new Error("Registered SmartRecruiters company identifier is invalid");
  if (!SMARTRECRUITERS_EXTERNAL_ID_PATTERN.test(externalId)) throw new Error("SmartRecruiters external id is invalid");
  const url = exactPublicJobUrl(raw, "SmartRecruiters");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodePathSegment(part, "SmartRecruiters"));
  const postingSegment = parts[1] ?? "";
  if (
    url.hostname.toLowerCase() !== SMARTRECRUITERS_HOST ||
    parts.length !== 2 ||
    parts[0] !== companyIdentifier ||
    !(postingSegment === externalId || postingSegment.startsWith(`${externalId}-`))
  ) {
    throw new Error("SmartRecruiters evidence URL does not match the registered source");
  }
  return url;
}

export function validateWorkdayEvidenceUrl(raw: string, boardToken: string, externalId: string) {
  const board = parseWorkdayBoardToken(boardToken);
  const job = parseWorkdayPublicUrl(raw);
  const expectedPath = normalizeWorkdayExternalPath(externalId);
  if (!job.externalPath) throw new Error("Workday evidence URL must identify an exact job posting");
  if (
    job.hostname !== board.hostname ||
    job.site !== board.site ||
    job.locale !== board.locale ||
    job.externalPath !== expectedPath
  ) {
    throw new Error("Workday evidence URL does not match the registered candidate-site source");
  }
  return new URL(job.canonicalUrl);
}

const BAMBOOHR_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const BAMBOOHR_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function validateBambooHrEvidenceUrl(raw: string, tenantSlug: string, externalId: string) {
  const slug = tenantSlug.trim().toLowerCase();
  if (!BAMBOOHR_SLUG_PATTERN.test(slug)) throw new Error("Registered BambooHR tenant slug is invalid");
  if (!BAMBOOHR_JOB_ID_PATTERN.test(externalId)) throw new Error("BambooHR external id is invalid");
  const url = exactPublicJobUrl(raw, "BambooHR");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodePathSegment(part, "BambooHR"));
  if (url.hostname.toLowerCase() !== `${slug}.bamboohr.com` || parts.length !== 2 || parts[0] !== "careers" || parts[1] !== externalId) {
    throw new Error("BambooHR evidence URL does not match the registered public careers source");
  }
  return url;
}

const RECRUITEE_TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const RECRUITEE_OFFER_SLUG_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;

export function validateRecruiteeEvidenceUrl(raw: string, tenantToken: string, externalId: string) {
  const tenant = tenantToken.trim().toLowerCase();
  if (!RECRUITEE_TENANT_PATTERN.test(tenant)) throw new Error("Registered Recruitee tenant is invalid");
  if (!RECRUITEE_OFFER_SLUG_PATTERN.test(externalId)) throw new Error("Recruitee offer slug is invalid");
  const url = exactPublicJobUrl(raw, "Recruitee");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodePathSegment(part, "Recruitee"));
  if (url.hostname.toLowerCase() !== `${tenant}.recruitee.com` || parts.length !== 2 || parts[0] !== "o" || parts[1] !== externalId) {
    throw new Error("Recruitee evidence URL does not match the registered public careers source");
  }
  return url;
}

function validateAtsEvidenceUrl(provider: AtsProvider, raw: string, sourceToken: string, externalId: string) {
  switch (provider) {
    case "greenhouse": return validateGreenhouseEvidenceUrl(raw, sourceToken, externalId);
    case "lever": return validateLeverEvidenceUrl(raw, sourceToken, externalId);
    case "ashby": return validateAshbyEvidenceUrl(raw, sourceToken, externalId);
    case "workable": return validateWorkableEvidenceUrl(raw, sourceToken, externalId);
    case "smartrecruiters": return validateSmartRecruitersEvidenceUrl(raw, sourceToken, externalId);
    case "workday": return validateWorkdayEvidenceUrl(raw, sourceToken, externalId);
    case "bamboohr": return validateBambooHrEvidenceUrl(raw, sourceToken, externalId);
    case "recruitee": return validateRecruiteeEvidenceUrl(raw, sourceToken, externalId);
  }
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
  provider?: AtsProvider;
  now?: () => string;
}) {
  if (options.persistedContent.length > 1_000_000) throw new Error("Persisted snapshot content exceeds extraction limit");
  const sourceUrl = validateAtsEvidenceUrl(options.provider ?? "greenhouse", options.evidenceUrl, options.boardToken, options.externalId).href;
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
      sourceType: "official_job_posting",
      extractedAt: now(),
      reviewState: "needs_review",
      ...suitabilityFor(email, options.companyDomain),
    });
  }
  return { contacts, rejections };
}
