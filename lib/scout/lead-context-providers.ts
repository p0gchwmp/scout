type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type LeadContextProvider = "apify" | "phantombuster" | "brightdata" | "scrapingdog" | "unify" | "generic";

export type SanitizedLeadContext = {
  provider: LeadContextProvider;
  linkedinUrl: string;
  profileType: "person" | "company" | "job";
  fullName: string | null;
  headline: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  summary: string | null;
  experience: string[];
  education: string[];
  observedAt: string;
};

export const LEAD_CONTEXT_CAPABILITIES = Object.freeze({
  manualLinkedInUrlRequired: true,
  apifyLiveLookup: true,
  phantomBusterExportImport: true,
  brightDataExportImport: true,
  scrapingdogExportImport: true,
  unifyRecordSink: true,
  linkedinAccountCredentialsAccepted: false,
  providerReturnedEmailPersisted: false,
  providerReturnedPhonePersisted: false,
  providerReturnedAddressPersisted: false,
  directOutreachEvidence: false,
  sendEmail: false,
  submitApplication: false,
} as const);

const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);
const PERSON_PATH = /^\/in\/([A-Za-z0-9%._~-]{2,220})\/?$/;
const COMPANY_PATH = /^\/company\/([A-Za-z0-9%._~-]{2,220})\/?$/;
const JOB_PATH = /^\/jobs\/view\/([A-Za-z0-9%._~-]{2,220})\/?$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{2,80}(?:[~/][A-Za-z0-9_.-]{2,120})?$/;
const UNIFY_OBJECT_PATTERN = /^[a-z][a-z0-9_]{1,80}$/;
const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const MAX_TEXT = 1200;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function compact(value: unknown, max = MAX_TEXT) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function firstString(raw: Record<string, unknown>, keys: readonly string[], max = MAX_TEXT) {
  for (const key of keys) {
    const value = compact(raw[key], max);
    if (value) return value;
  }
  for (const value of Object.values(raw)) {
    const nested = record(value);
    if (!nested) continue;
    for (const key of keys) {
      const candidate = compact(nested[key], max);
      if (candidate) return candidate;
    }
  }
  return null;
}

function arrayRecords(raw: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key] as unknown[];
  }
  return [];
}

function summarizeExperience(raw: Record<string, unknown>) {
  const items = arrayRecords(raw, ["experience", "experiences", "positions", "workExperience", "work_experience"]);
  return items.slice(0, 12).flatMap((item) => {
    const entry = record(item);
    if (!entry) return [];
    const role = firstString(entry, ["title", "role", "position", "jobTitle", "job_title"], 180);
    const company = firstString(entry, ["companyName", "company_name", "company", "organization", "organisation"], 180);
    const period = firstString(entry, ["dateRange", "date_range", "duration", "dates"], 120);
    const text = [role, company, period].filter(Boolean).join(" — ");
    return text ? [text.slice(0, 420)] : [];
  });
}

function summarizeEducation(raw: Record<string, unknown>) {
  const items = arrayRecords(raw, ["education", "educations", "schools"]);
  return items.slice(0, 10).flatMap((item) => {
    const entry = record(item);
    if (!entry) return [];
    const school = firstString(entry, ["schoolName", "school_name", "school", "institution"], 180);
    const degree = firstString(entry, ["degreeName", "degree_name", "degree"], 180);
    const field = firstString(entry, ["fieldOfStudy", "field_of_study", "field"], 180);
    const text = [school, degree, field].filter(Boolean).join(" — ");
    return text ? [text.slice(0, 420)] : [];
  });
}

export function normalizeLinkedInLeadUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("LinkedIn lead URL is invalid"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !LINKEDIN_HOSTS.has(host)) {
    throw new Error("LinkedIn lead URL must be an exact public linkedin.com HTTPS URL");
  }
  let profileType: SanitizedLeadContext["profileType"];
  if (PERSON_PATH.test(url.pathname)) profileType = "person";
  else if (COMPANY_PATH.test(url.pathname)) profileType = "company";
  else if (JOB_PATH.test(url.pathname)) profileType = "job";
  else throw new Error("LinkedIn lead URL must point to a person, company, or job page");
  url.hostname = "www.linkedin.com";
  url.search = "";
  url.hash = "";
  return { url: url.href, profileType };
}

export function sanitizeLeadContextRecord(input: {
  provider: LeadContextProvider;
  linkedinUrl: string;
  raw: unknown;
  observedAt?: string;
}): SanitizedLeadContext {
  const identity = normalizeLinkedInLeadUrl(input.linkedinUrl);
  const source = Array.isArray(input.raw) ? record(input.raw[0]) : record(input.raw);
  if (!source) throw new Error("Lead-context provider returned an invalid record");
  const observed = input.observedAt ? new Date(input.observedAt) : new Date();
  if (!Number.isFinite(observed.getTime())) throw new Error("Lead-context observed timestamp is invalid");

  return {
    provider: input.provider,
    linkedinUrl: identity.url,
    profileType: identity.profileType,
    fullName: firstString(source, ["fullName", "full_name", "name", "displayName", "display_name"], 220),
    headline: firstString(source, ["headline", "occupation", "tagline"], 320),
    company: firstString(source, ["companyName", "company_name", "company", "currentCompanyName", "current_company_name"], 220),
    role: firstString(source, ["jobTitle", "job_title", "currentPosition", "current_position", "position", "title"], 220),
    location: firstString(source, ["location", "locationName", "location_name", "geo"], 220),
    summary: firstString(source, ["about", "summary", "bio", "description"], 1200),
    experience: summarizeExperience(source),
    education: summarizeEducation(source),
    observedAt: observed.toISOString(),
  };
}

export async function fetchApifyLeadContext(input: {
  apiToken: string;
  actorId: string;
  linkedinUrl: string;
  fetcher?: FetchLike;
  now?: () => Date;
}) {
  const token = input.apiToken.trim();
  const actorId = input.actorId.trim();
  if (!token || token.length > 500) throw new Error("Apify API token is invalid");
  if (!PROVIDER_ID_PATTERN.test(actorId)) throw new Error("Apify actor id is invalid");
  const linkedIn = normalizeLinkedInLeadUrl(input.linkedinUrl);
  const actor = actorId.replace("/", "~");
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actor).replace(/%7E/gi, "~")}/run-sync-get-dataset-items`;
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ profileUrls: [linkedIn.url] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Apify lead-context lookup failed (${response.status})`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Apify response exceeded the size limit");
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Apify response exceeded the size limit");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new Error("Apify returned invalid JSON"); }
  return sanitizeLeadContextRecord({
    provider: "apify",
    linkedinUrl: linkedIn.url,
    raw,
    observedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
}

export async function pushLeadContextToUnify(input: {
  apiKey: string;
  objectName: string;
  context: SanitizedLeadContext;
  fetcher?: FetchLike;
}) {
  const apiKey = input.apiKey.trim();
  const objectName = input.objectName.trim();
  if (!apiKey || apiKey.length > 500) throw new Error("Unify API key is invalid");
  if (!UNIFY_OBJECT_PATTERN.test(objectName)) throw new Error("Unify object name is invalid");
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`https://api.unifygtm.com/data/v1/objects/${objectName}/records`, {
    method: "POST",
    redirect: "error",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      attributes: {
        source_provider: input.context.provider,
        source_url: input.context.linkedinUrl,
        profile_type: input.context.profileType,
        full_name: input.context.fullName,
        headline: input.context.headline,
        company: input.context.company,
        role: input.context.role,
        location: input.context.location,
        summary: input.context.summary,
        experience_json: JSON.stringify(input.context.experience),
        education_json: JSON.stringify(input.context.education),
        observed_at: input.context.observedAt,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Unify lead-context write failed (${response.status})`);
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Unify response exceeded the size limit");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new Error("Unify returned invalid JSON"); }
  return raw;
}
