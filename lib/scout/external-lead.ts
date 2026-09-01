export const EXTERNAL_LEAD_CAPABILITIES = Object.freeze({
  sproutManualImport: true,
  oneClickVisiblePageCapture: true,
  automaticOfficialResolution: true,
  automaticApplicationPreparation: true,
  automaticPublicContactResearch: true,
  exactSourceUrlPreserved: true,
  independentOfficialUrlOptional: true,
  leadOnlyUntilOfficialResolution: true,
  fetchSproutAccount: false,
  callUndocumentedSproutApi: false,
  scrapeSprout: false,
  useSproutCredentials: false,
  trustSproutAsEmployerEvidence: false,
  autoAcceptContact: false,
  send: false,
  submit: false,
} as const);

export type ExternalLeadSource = "sprout";

export type NormalizedExternalLead = {
  source: ExternalLeadSource;
  sourceLabel: string;
  trust: "lead_only";
  requiresOfficialResolution: true;
  leadUrl: string;
  resolutionCandidateUrl: string;
  company: string;
  title: string;
};

const PRIVATE_HOST_PATTERNS = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./, /^\[?::1\]?$/i];

function clean(value: unknown, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > max || /[\r\n\0]/.test(value)) throw new Error(`${field} is invalid`);
  return result;
}

function publicHttps(value: unknown, field: string) {
  const raw = clean(value, field, 1600);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${field} is invalid`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error(`${field} must be a public HTTPS URL without credentials or a custom port`);
  }
  url.hash = "";
  return url;
}

function sproutHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "usesprout.com" || host.endsWith(".usesprout.com");
}

export function normalizeExternalLead(input: {
  source: unknown;
  leadUrl: unknown;
  company: unknown;
  title: unknown;
  officialUrl?: unknown;
}): NormalizedExternalLead {
  if (input.source !== "sprout") throw new Error("External lead source is not supported");
  const leadUrl = publicHttps(input.leadUrl, "Sprout lead URL");
  if (!sproutHost(leadUrl.hostname)) throw new Error("Sprout lead URL must be on usesprout.com");
  const company = clean(input.company, "Company", 200);
  const title = clean(input.title, "Role title", 300);

  let resolutionCandidateUrl = leadUrl.href;
  if (input.officialUrl !== undefined && input.officialUrl !== null && String(input.officialUrl).trim()) {
    const official = publicHttps(input.officialUrl, "Official employer/ATS URL");
    if (sproutHost(official.hostname)) throw new Error("Official employer/ATS URL must be independent of Sprout");
    resolutionCandidateUrl = official.href;
  }

  return {
    source: "sprout",
    sourceLabel: "Sprout visible-page capture",
    trust: "lead_only",
    requiresOfficialResolution: true,
    leadUrl: leadUrl.href,
    resolutionCandidateUrl,
    company,
    title,
  };
}
