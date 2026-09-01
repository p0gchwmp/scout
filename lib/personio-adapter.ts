import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types.ts";

const PERSONIO_TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const PERSONIO_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.jobs\.personio\.de$/i;
const PERSONIO_EXTERNAL_ID_PATTERN = /^[0-9]{1,20}$/;
const PERSONIO_TIMEOUT_MS = 10_000;
const PERSONIO_MAX_XML_BYTES = 1_500_000;
const PERSONIO_MAX_POSTINGS = 500;

export type PersonioPublicJobIdentity = {
  tenant: string;
  externalId: string;
  canonicalUrl: string;
};

function tenant(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!PERSONIO_TENANT_PATTERN.test(normalized) || normalized === "www" || normalized === "api") {
    throw new Error("Registered Personio tenant is invalid");
  }
  return normalized;
}

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function xmlText(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  return match?.[1] ? decodeXml(match[1].trim()).trim() : "";
}

function textOnly(value: string) {
  return decodeXml(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function workplaceFromText(value: string): WorkplaceType {
  const text = value.toLowerCase();
  if (/\bremote\b|\bwork from home\b|\bhome[- ]?office\b/.test(text)) return "remote";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bon[ -]?site\b|\bonsite\b|\bin[- ]office\b/.test(text)) return "on-site";
  return "unspecified";
}

function isoDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function descriptions(position: string) {
  const container = position.match(/<jobDescriptions\b[^>]*>([\s\S]*?)<\/jobDescriptions>/i)?.[1] ?? "";
  const blocks = container.match(/<jobDescription\b[^>]*>[\s\S]*?<\/jobDescription>/gi) ?? [];
  return blocks.map((block) => {
    const name = textOnly(xmlText(block, "name"));
    const value = textOnly(xmlText(block, "value"));
    return [name, value].filter(Boolean).join(": ");
  }).filter(Boolean).join("\n\n").slice(0, 500_000);
}

function canonicalUrl(rawTenant: string, externalId: string) {
  return `https://${tenant(rawTenant)}.jobs.personio.de/job/${externalId}`;
}

export function parsePersonioPublicJobUrl(raw: string): PersonioPublicJobIdentity {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("Personio job URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Personio job URL must be an exact HTTPS job URL");
  }
  const hostMatch = url.hostname.toLowerCase().match(PERSONIO_HOST_PATTERN);
  if (!hostMatch) throw new Error("Personio job URL host is not a supported Personio career site");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "job" || !PERSONIO_EXTERNAL_ID_PATTERN.test(parts[1])) {
    throw new Error("Personio job URL path is invalid");
  }
  const rawTenant = tenant(hostMatch[1]);
  return {
    tenant: rawTenant,
    externalId: parts[1],
    canonicalUrl: canonicalUrl(rawTenant, parts[1]),
  };
}

function parsePositions(xml: string, rawTenant: string): NormalizedJob[] {
  const blocks = xml.match(/<position\b[^>]*>[\s\S]*?<\/position>/gi) ?? [];
  if (blocks.length > PERSONIO_MAX_POSTINGS) throw new Error(`Personio source exceeds the ${PERSONIO_MAX_POSTINGS}-posting safe discovery limit`);
  const jobs: NormalizedJob[] = [];
  for (const block of blocks) {
    const externalId = textOnly(xmlText(block, "id"));
    const title = textOnly(xmlText(block, "name")).slice(0, 300);
    if (!PERSONIO_EXTERNAL_ID_PATTERN.test(externalId) || !title) continue;
    const office = textOnly(xmlText(block, "office")).slice(0, 500);
    const department = textOnly(xmlText(block, "department"));
    const employmentType = textOnly(xmlText(block, "employmentType"));
    const seniority = textOnly(xmlText(block, "seniority"));
    const schedule = textOnly(xmlText(block, "schedule"));
    const description = descriptions(block);
    const context = [office, department, employmentType, seniority, schedule, description].filter(Boolean).join("\n");
    jobs.push({
      source: "personio",
      externalId,
      canonicalUrl: canonicalUrl(rawTenant, externalId),
      company: textOnly(xmlText(block, "subcompany")) || tenant(rawTenant),
      title,
      description,
      location: office,
      workplaceType: workplaceFromText(context),
      postedAt: isoDate(textOnly(xmlText(block, "createdAt"))),
    });
  }
  return jobs;
}

export class PersonioPublicXmlAdapter implements SourceAdapter {
  readonly source = "personio";
  readonly capabilities = {
    discovery: true,
    submission: false,
    publicXmlFeedOnly: true,
    noCredentials: true,
    candidateCreation: false,
    applicationWriteApi: false,
    fixedPersonioHostOnly: true,
  } as const;

  private async fetchFeed(rawTenant: string) {
    const expectedTenant = tenant(rawTenant);
    const url = `https://${expectedTenant}.jobs.personio.de/xml?language=en`;
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/xml,text/xml;q=0.9,text/plain;q=0.7" },
      signal: AbortSignal.timeout(PERSONIO_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new Error(`Personio public XML feed failed (${response.status})`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > PERSONIO_MAX_XML_BYTES) throw new Error("Personio XML feed exceeds the safe size limit");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > PERSONIO_MAX_XML_BYTES) throw new Error("Personio XML feed exceeds the safe size limit");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const xml = new TextDecoder().decode(bytes);
    if (contentType && !/xml|text\/plain/.test(contentType) && !/^\s*(?:<\?xml[^>]*>\s*)?<workzag-jobs\b/i.test(xml)) {
      throw new Error("Personio feed returned unsupported content");
    }
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<workzag-jobs\b/i.test(xml)) throw new Error("Personio feed did not contain the expected jobs document");
    return xml;
  }

  async discover(rawTenant: string): Promise<NormalizedJob[]> {
    const expectedTenant = tenant(rawTenant);
    const xml = await this.fetchFeed(expectedTenant);
    if (!xml) throw new Error("Personio public XML feed was not found");
    return parsePositions(xml, expectedTenant);
  }

  async discoverPosting(rawTenant: string, rawExternalId: string): Promise<NormalizedJob | null> {
    const externalId = rawExternalId.trim();
    if (!PERSONIO_EXTERNAL_ID_PATTERN.test(externalId)) throw new Error("Personio external id is invalid");
    const jobs = await this.discover(rawTenant);
    return jobs.find((job) => job.externalId === externalId) ?? null;
  }
}
