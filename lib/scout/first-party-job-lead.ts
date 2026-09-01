export const FIRST_PARTY_JOB_LEAD_CAPABILITIES = Object.freeze({
  parseJobPostingJsonLd: true,
  exactOfficialDomainRequired: true,
  leadOnlyUntilOfficialResolution: true,
  arbitraryUrlFetch: false,
  extractContacts: false,
  inferEmails: false,
  send: false,
  submit: false,
} as const);

export type FirstPartyJobLead = {
  sourceKind: "first_party_jsonld";
  trust: "lead_only";
  requiresOfficialResolution: true;
  canonicalUrl: string;
  company: string;
  title: string;
  description: string;
  location: string;
  postedAt: string | null;
};

const MAX_HTML_BYTES = 1_000_000;
const MAX_JSONLD_BLOCKS = 40;
const MAX_DESCRIPTION = 120_000;

function normalizeDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^www\./, "");
  if (!domain || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain) || domain.includes("..")) throw new Error("Official company domain is invalid");
  return domain;
}

function exactOfficialUrl(value: string, companyDomain: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("First-party job URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new Error("First-party job URL must be an exact HTTPS URL");
  const domain = normalizeDomain(companyDomain);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== domain && !host.endsWith(`.${domain}`)) throw new Error("First-party job URL is outside the controlled company domain");
  return url;
}

function plainText(value: unknown, max = MAX_DESCRIPTION) {
  if (typeof value !== "string") return "";
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function types(value: unknown) {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jobPostingNodes(value: unknown, out: Record<string, unknown>[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) jobPostingNodes(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (types(record["@type"]).some((type) => type.toLowerCase() === "jobposting")) out.push(record);
  if (Array.isArray(record["@graph"])) jobPostingNodes(record["@graph"], out);
}

function locationFrom(node: Record<string, unknown>) {
  const remote = node.jobLocationType === "TELECOMMUTE" || node.jobLocationType === "Remote";
  if (remote) return "Remote";
  const raw = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
  if (!raw || typeof raw !== "object") return "";
  const address = (raw as Record<string, unknown>).address;
  if (typeof address === "string") return plainText(address, 500);
  if (!address || typeof address !== "object") return "";
  const record = address as Record<string, unknown>;
  return [record.addressLocality, record.addressRegion, record.addressCountry]
    .map((item) => typeof item === "string" ? plainText(item, 120) : "")
    .filter(Boolean)
    .join(", ");
}

function companyFrom(node: Record<string, unknown>, fallback: string) {
  const org = node.hiringOrganization;
  if (org && typeof org === "object" && !Array.isArray(org)) {
    const name = plainText((org as Record<string, unknown>).name, 300);
    if (name) return name;
  }
  return plainText(fallback, 300);
}

function validPostedAt(value: unknown) {
  if (typeof value !== "string" || value.length > 100 || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function extractFirstPartyJobLeads(input: {
  html: string;
  canonicalUrl: string;
  companyDomain: string;
  companyName: string;
}): FirstPartyJobLead[] {
  if (typeof input.html !== "string" || Buffer.byteLength(input.html, "utf8") > MAX_HTML_BYTES) throw new Error("First-party careers HTML is too large");
  const canonical = exactOfficialUrl(input.canonicalUrl, input.companyDomain).href;
  const blocks = [...input.html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].slice(0, MAX_JSONLD_BLOCKS);
  const nodes: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const raw = block[1]?.trim();
    if (!raw) continue;
    try { jobPostingNodes(JSON.parse(raw), nodes); }
    catch { continue; }
  }

  const leads: FirstPartyJobLead[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const title = plainText(node.title, 500);
    const description = plainText(node.description);
    if (!title || !description) continue;
    const key = `${title.toLowerCase()}\n${description.slice(0, 500).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      sourceKind: "first_party_jsonld",
      trust: "lead_only",
      requiresOfficialResolution: true,
      canonicalUrl: canonical,
      company: companyFrom(node, input.companyName),
      title,
      description,
      location: locationFrom(node),
      postedAt: validPostedAt(node.datePosted),
    });
  }
  return leads.slice(0, 50);
}
