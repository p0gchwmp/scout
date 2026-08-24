import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types.ts";

const TEAMTAILOR_TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TEAMTAILOR_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.teamtailor\.com$/i;
const TEAMTAILOR_JOB_SEGMENT_PATTERN = /^([0-9]{1,20})-(.{1,300})$/;
const TEAMTAILOR_TIMEOUT_MS = 10_000;
const TEAMTAILOR_MAX_PAGE_BYTES = 1_500_000;
const TEAMTAILOR_MAX_POSTINGS = 250;
const TEAMTAILOR_DETAIL_CONCURRENCY = 4;

export type TeamtailorPublicJobIdentity = {
  tenant: string;
  externalId: string;
  jobSegment: string;
  canonicalUrl: string;
};

function tenant(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!TEAMTAILOR_TENANT_PATTERN.test(normalized)) throw new Error("Registered Teamtailor tenant is invalid");
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
  if (/\bfully\s+remote\b|\bremote\b/.test(text)) return "remote";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bon[ -]?site\b|\bonsite\b/.test(text)) return "on-site";
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
      // Skip malformed unrelated JSON-LD blocks and continue looking for a JobPosting.
    }
  }
  return null;
}

function htmlHeading(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? htmlText(match[1]).slice(0, 300) : "";
}

function markdownHeading(markdown: string) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

function markdownToText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonLdWorkplace(job: Record<string, unknown>, description: string): WorkplaceType {
  const locationType = String(job.jobLocationType ?? "").toLowerCase();
  if (locationType.includes("telecommute")) return "remote";
  return workplaceFromText(`${String(job.employmentType ?? "")} ${description}`);
}

function validateJsonLdUrl(job: Record<string, unknown>, identity: TeamtailorPublicJobIdentity) {
  if (typeof job.url !== "string" || !job.url.trim()) return;
  const observed = parseTeamtailorPublicJobUrl(job.url.trim());
  if (observed.tenant !== identity.tenant || observed.externalId !== identity.externalId) {
    throw new Error("Teamtailor JobPosting metadata does not match the requested job URL");
  }
}

function canonicalJobSegment(raw: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(raw); }
  catch { throw new Error("Teamtailor job URL contains invalid encoding"); }
  if (decoded.includes("/") || decoded.includes("\\") || /[\u0000-\u001F\u007F]/.test(decoded)) {
    throw new Error("Teamtailor job URL contains an invalid job segment");
  }
  const match = decoded.match(TEAMTAILOR_JOB_SEGMENT_PATTERN);
  if (!match || !match[2].trim()) throw new Error("Teamtailor job URL does not contain a valid job id and title slug");
  return { decoded, externalId: match[1] };
}

export function parseTeamtailorPublicJobUrl(raw: string): TeamtailorPublicJobIdentity {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("Teamtailor job URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Teamtailor job URL must be an exact HTTPS candidate-site URL");
  }
  const host = url.hostname.toLowerCase();
  const hostMatch = host.match(TEAMTAILOR_HOST_PATTERN);
  if (!hostMatch) throw new Error("Teamtailor job URL host is not a supported Teamtailor-hosted career site");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "jobs") throw new Error("Teamtailor job URL path is invalid");
  const segment = canonicalJobSegment(parts[1]);
  return {
    tenant: hostMatch[1].toLowerCase(),
    externalId: segment.externalId,
    jobSegment: segment.decoded,
    canonicalUrl: `https://${host}/jobs/${encodeURIComponent(segment.decoded).replace(/%2D/gi, "-")}`,
  };
}

function extractCandidateJobUrls(rawTenant: string, content: string) {
  const expectedTenant = tenant(rawTenant);
  const host = `${expectedTenant}.teamtailor.com`;
  const values = new Set<string>();
  const candidates = [
    ...content.matchAll(/href=["']([^"']+)["']/gi),
    ...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g),
  ];
  for (const match of candidates) {
    const href = match[1]?.trim();
    if (!href) continue;
    let url: URL;
    try { url = new URL(href, `https://${host}/sitemap`); }
    catch { continue; }
    if (url.hostname.toLowerCase() !== host) continue;
    try {
      const identity = parseTeamtailorPublicJobUrl(url.href);
      values.add(identity.canonicalUrl);
    } catch {
      // Sitemap contains locations, pages and posts too; only exact job URLs are admitted.
    }
  }
  if (values.size > TEAMTAILOR_MAX_POSTINGS) {
    throw new Error(`Teamtailor source exceeds the ${TEAMTAILOR_MAX_POSTINGS}-posting safe discovery limit`);
  }
  return [...values];
}

export class TeamtailorOfficialPageAdapter implements SourceAdapter {
  readonly source = "teamtailor";
  readonly capabilities = {
    discovery: true,
    submission: false,
    exactPageResolution: true,
    publicCandidateSiteOnly: true,
    markdownContentNegotiation: true,
    sitemapDiscoverySurface: true,
    employerApiCredentials: false,
    apiKey: false,
    customDomainGuessing: false,
    candidateCreation: false,
  } as const;

  private async fetchPage(url: string) {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "text/markdown, text/html;q=0.9" },
      signal: AbortSignal.timeout(TEAMTAILOR_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new Error(`Teamtailor public career-site fetch failed (${response.status})`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > TEAMTAILOR_MAX_PAGE_BYTES) {
      throw new Error("Teamtailor public career-site page exceeds the safe size limit");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > TEAMTAILOR_MAX_PAGE_BYTES) throw new Error("Teamtailor public career-site page exceeds the safe size limit");
    return {
      content: new TextDecoder().decode(bytes),
      contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
    };
  }

  async discoverPostingUrl(rawUrl: string): Promise<NormalizedJob | null> {
    const identity = parseTeamtailorPublicJobUrl(rawUrl);
    const page = await this.fetchPage(identity.canonicalUrl);
    if (!page) return null;
    const { content, contentType } = page;
    const looksMarkdown = contentType.includes("markdown") || contentType.includes("text/plain");
    const looksHtml = contentType.includes("html") || /^\s*<!doctype html|^\s*<html\b/i.test(content) || /<script\b[^>]*type=["']application\/ld\+json/i.test(content);
    if (!looksMarkdown && !looksHtml) throw new Error("Teamtailor official job page returned unsupported content");

    if (looksHtml) {
      const job = parseJsonLdJob(content);
      if (job) {
        validateJsonLdUrl(job, identity);
        const description = textValue(job.description);
        const title = textValue(job.title ?? job.name).slice(0, 300);
        if (!title) throw new Error("Teamtailor JobPosting metadata is missing a title");
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

      const title = htmlHeading(content);
      const pageText = htmlText(content);
      if (!title || !/\bApply (?:for|to) this (?:job|role)\b/i.test(pageText)) {
        throw new Error("Teamtailor candidate page did not contain verifiable job-posting content");
      }
      return {
        source: this.source,
        externalId: identity.externalId,
        canonicalUrl: identity.canonicalUrl,
        company: identity.tenant,
        title,
        description: pageText.slice(0, 500_000),
        location: "",
        workplaceType: workplaceFromText(pageText),
      };
    }

    const title = markdownHeading(content);
    const pageText = markdownToText(content);
    if (!title || !/\bApply (?:for|to) this (?:job|role)\b/i.test(pageText)) {
      throw new Error("Teamtailor candidate page did not contain verifiable job-posting content");
    }
    return {
      source: this.source,
      externalId: identity.externalId,
      canonicalUrl: identity.canonicalUrl,
      company: identity.tenant,
      title,
      description: pageText.slice(0, 500_000),
      location: "",
      workplaceType: workplaceFromText(pageText),
    };
  }

  async discoverPosting(rawTenant: string, rawExternalId: string): Promise<NormalizedJob | null> {
    const expectedTenant = tenant(rawTenant);
    if (!/^[0-9]{1,20}$/.test(rawExternalId)) throw new Error("Teamtailor external job id is invalid");
    const sitemap = await this.fetchPage(`https://${expectedTenant}.teamtailor.com/sitemap`);
    if (!sitemap) return null;
    const url = extractCandidateJobUrls(expectedTenant, sitemap.content)
      .find((candidate) => parseTeamtailorPublicJobUrl(candidate).externalId === rawExternalId);
    return url ? this.discoverPostingUrl(url) : null;
  }

  async discover(rawTenant: string): Promise<NormalizedJob[]> {
    const expectedTenant = tenant(rawTenant);
    const sitemap = await this.fetchPage(`https://${expectedTenant}.teamtailor.com/sitemap`);
    if (!sitemap) throw new Error("Teamtailor public career-site sitemap was not found");
    const urls = extractCandidateJobUrls(expectedTenant, sitemap.content);
    const jobs: NormalizedJob[] = [];
    for (let index = 0; index < urls.length; index += TEAMTAILOR_DETAIL_CONCURRENCY) {
      const batch = urls.slice(index, index + TEAMTAILOR_DETAIL_CONCURRENCY);
      const results = await Promise.all(batch.map((url) => this.discoverPostingUrl(url)));
      for (const job of results) if (job) jobs.push(job);
    }
    const ids = jobs.map((job) => job.externalId);
    if (new Set(ids).size !== ids.length) throw new Error("Teamtailor public career site returned duplicate job ids");
    return jobs;
  }
}
