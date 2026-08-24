import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types.ts";

const BREEZY_TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const BREEZY_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.breezy\.hr$/i;
const BREEZY_POSITION_SEGMENT_PATTERN = /^([a-z0-9]{6,64})-(.{1,300})$/i;
const BREEZY_RESERVED_TENANTS = new Set(["api", "www"]);
const BREEZY_TIMEOUT_MS = 10_000;
const BREEZY_MAX_PAGE_BYTES = 1_500_000;
const BREEZY_MAX_POSTINGS = 300;
const BREEZY_DETAIL_CONCURRENCY = 4;

export type BreezyPublicJobIdentity = {
  tenant: string;
  externalId: string;
  jobSegment: string;
  canonicalUrl: string;
};

function tenant(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!BREEZY_TENANT_PATTERN.test(normalized) || BREEZY_RESERVED_TENANTS.has(normalized)) {
    throw new Error("Registered Breezy tenant is invalid");
  }
  return normalized;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function htmlText(value: unknown) {
  return decodeHtml(String(value ?? ""))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textValue(value: unknown) {
  return htmlText(value).slice(0, 500_000);
}

function workplaceFromText(value: string): WorkplaceType {
  const text = value.toLowerCase();
  if (/\bremote(?:\s+anywhere|\s+within)?\b|\bwork from home\b/.test(text)) return "remote";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bon[ -]?site\b|\bonsite\b|\bin[- ]office\b/.test(text)) return "on-site";
  return "unspecified";
}

function jobLocationText(value: unknown) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const locations = entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const address = record.address && typeof record.address === "object" && !Array.isArray(record.address)
      ? record.address as Record<string, unknown>
      : record;
    const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
      .map((part) => typeof part === "string" ? part.trim() : "")
      .filter(Boolean);
    return parts.length ? [parts.join(", ")] : [];
  });
  return [...new Set(locations)].join(" / ").slice(0, 500);
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findJobPosting(item);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return record;
  for (const key of ["@graph", "itemListElement", "mainEntity"]) {
    const match = findJobPosting(record[key]);
    if (match) return match;
  }
  return null;
}

function parseJsonLdJob(html: string) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      const job = findJobPosting(parsed);
      if (job) return job;
    } catch {
      // Ignore malformed unrelated JSON-LD blocks.
    }
  }
  return null;
}

function htmlHeading(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? htmlText(match[1]).slice(0, 300) : "";
}

function htmlTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlText(match[1]).slice(0, 300) : "";
}

function fallbackCompanyFromTitle(value: string, rawTenant: string) {
  const match = value.match(/\s+at\s+(.+)$/i);
  return (match?.[1]?.trim() || rawTenant).slice(0, 200);
}

function fallbackJobTitle(value: string) {
  return value.replace(/\s+at\s+.+$/i, "").trim().slice(0, 300);
}

function jsonLdWorkplace(job: Record<string, unknown>, description: string): WorkplaceType {
  const locationType = String(job.jobLocationType ?? "").toLowerCase();
  if (locationType.includes("telecommute")) return "remote";
  return workplaceFromText(`${String(job.employmentType ?? "")} ${description}`);
}

function hasControlCharacters(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function canonicalJobSegment(raw: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(raw); }
  catch { throw new Error("Breezy job URL contains invalid encoding"); }
  if (decoded.includes("/") || decoded.includes("\\") || hasControlCharacters(decoded)) {
    throw new Error("Breezy job URL contains an invalid position segment");
  }
  const match = decoded.match(BREEZY_POSITION_SEGMENT_PATTERN);
  if (!match || !match[2].trim()) throw new Error("Breezy job URL does not contain a valid position id and title slug");
  return { decoded, externalId: match[1].toLowerCase() };
}

export function parseBreezyPublicJobUrl(raw: string): BreezyPublicJobIdentity {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("Breezy job URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Breezy job URL must be an exact HTTPS candidate-site URL");
  }
  const host = url.hostname.toLowerCase();
  const hostMatch = host.match(BREEZY_HOST_PATTERN);
  if (!hostMatch || BREEZY_RESERVED_TENANTS.has(hostMatch[1].toLowerCase())) {
    throw new Error("Breezy job URL host is not a supported Breezy-hosted career site");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "p") throw new Error("Breezy job URL path is invalid");
  const segment = canonicalJobSegment(parts[1]);
  return {
    tenant: hostMatch[1].toLowerCase(),
    externalId: segment.externalId,
    jobSegment: segment.decoded,
    canonicalUrl: `https://${host}/p/${encodeURIComponent(segment.decoded).replace(/%2D/gi, "-")}`,
  };
}

function validateJsonLdUrl(job: Record<string, unknown>, identity: BreezyPublicJobIdentity) {
  if (typeof job.url !== "string" || !job.url.trim()) return;
  const observed = parseBreezyPublicJobUrl(job.url.trim());
  if (observed.tenant !== identity.tenant || observed.externalId !== identity.externalId) {
    throw new Error("Breezy JobPosting metadata does not match the requested job URL");
  }
}

function extractCandidateJobUrls(rawTenant: string, content: string) {
  const expectedTenant = tenant(rawTenant);
  const host = `${expectedTenant}.breezy.hr`;
  const values = new Set<string>();
  const candidates = [
    ...content.matchAll(/href=["']([^"']+)["']/gi),
    ...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g),
  ];
  for (const match of candidates) {
    const href = match[1]?.trim();
    if (!href) continue;
    let url: URL;
    try { url = new URL(href, `https://${host}/`); }
    catch { continue; }
    if (url.hostname.toLowerCase() !== host) continue;
    try {
      const identity = parseBreezyPublicJobUrl(url.href);
      values.add(identity.canonicalUrl);
    } catch {
      // Career portal links can include company pages and non-position routes.
    }
  }
  if (values.size > BREEZY_MAX_POSTINGS) {
    throw new Error(`Breezy source exceeds the ${BREEZY_MAX_POSTINGS}-posting safe discovery limit`);
  }
  return [...values];
}

export class BreezyOfficialPageAdapter implements SourceAdapter {
  readonly source = "breezy";
  readonly capabilities = {
    discovery: true,
    submission: false,
    exactPageResolution: true,
    publicCandidateSiteOnly: true,
    careerPortalDiscoverySurface: true,
    employerApiCredentials: false,
    apiKey: false,
    customDomainGuessing: false,
    candidateCreation: false,
  } as const;

  private async fetchPage(url: string) {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "text/html, application/xhtml+xml;q=0.9" },
      signal: AbortSignal.timeout(BREEZY_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new Error(`Breezy public career-site fetch failed (${response.status})`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > BREEZY_MAX_PAGE_BYTES) {
      throw new Error("Breezy public career-site page exceeds the safe size limit");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > BREEZY_MAX_PAGE_BYTES) throw new Error("Breezy public career-site page exceeds the safe size limit");
    return {
      content: new TextDecoder().decode(bytes),
      contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
    };
  }

  async discoverPostingUrl(rawUrl: string): Promise<NormalizedJob | null> {
    const identity = parseBreezyPublicJobUrl(rawUrl);
    const page = await this.fetchPage(identity.canonicalUrl);
    if (!page) return null;
    const { content, contentType } = page;
    const looksHtml = contentType.includes("html") || /^\s*<!doctype html|^\s*<html\b/i.test(content) || /<script\b[^>]*type=["']application\/ld\+json/i.test(content);
    if (!looksHtml) throw new Error("Breezy official job page returned unsupported content");

    const job = parseJsonLdJob(content);
    if (job) {
      validateJsonLdUrl(job, identity);
      const description = textValue(job.description);
      const title = textValue(job.title ?? job.name).slice(0, 300);
      if (!title) throw new Error("Breezy JobPosting metadata is missing a title");
      const organization = job.hiringOrganization && typeof job.hiringOrganization === "object" && !Array.isArray(job.hiringOrganization)
        ? job.hiringOrganization as Record<string, unknown>
        : null;
      return {
        source: this.source,
        externalId: identity.externalId,
        canonicalUrl: identity.canonicalUrl,
        company: textValue(organization?.name ?? identity.tenant).slice(0, 200),
        title,
        description,
        location: jobLocationText(job.jobLocation),
        workplaceType: jsonLdWorkplace(job, description),
        postedAt: typeof job.datePosted === "string" ? job.datePosted : undefined,
      };
    }

    const titleTag = htmlTitle(content);
    const title = htmlHeading(content) || fallbackJobTitle(titleTag);
    const pageText = htmlText(content);
    if (!title || !/(?:apply to (?:this )?position|button_apply_to_position|apply now|apply for this (?:job|position))/i.test(pageText)) {
      throw new Error("Breezy candidate page did not contain verifiable job-posting content");
    }
    return {
      source: this.source,
      externalId: identity.externalId,
      canonicalUrl: identity.canonicalUrl,
      company: fallbackCompanyFromTitle(titleTag, identity.tenant),
      title,
      description: pageText.slice(0, 500_000),
      location: "",
      workplaceType: workplaceFromText(pageText),
    };
  }

  async discoverPosting(rawTenant: string, rawExternalId: string): Promise<NormalizedJob | null> {
    const expectedTenant = tenant(rawTenant);
    const expectedExternalId = rawExternalId.trim().toLowerCase();
    if (!/^[a-z0-9]{6,64}$/i.test(expectedExternalId)) throw new Error("Breezy external position id is invalid");
    const portal = await this.fetchPage(`https://${expectedTenant}.breezy.hr/`);
    if (!portal) return null;
    const url = extractCandidateJobUrls(expectedTenant, portal.content)
      .find((candidate) => parseBreezyPublicJobUrl(candidate).externalId === expectedExternalId);
    return url ? this.discoverPostingUrl(url) : null;
  }

  async discover(rawTenant: string): Promise<NormalizedJob[]> {
    const expectedTenant = tenant(rawTenant);
    const portal = await this.fetchPage(`https://${expectedTenant}.breezy.hr/`);
    if (!portal) throw new Error("Breezy public career portal was not found");
    const urls = extractCandidateJobUrls(expectedTenant, portal.content);
    const jobs: NormalizedJob[] = [];
    for (let index = 0; index < urls.length; index += BREEZY_DETAIL_CONCURRENCY) {
      const batch = urls.slice(index, index + BREEZY_DETAIL_CONCURRENCY);
      const details = await Promise.all(batch.map((url) => this.discoverPostingUrl(url)));
      for (const job of details) if (job) jobs.push(job);
    }
    return jobs;
  }
}
