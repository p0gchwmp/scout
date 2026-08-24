const WORKDAY_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(wd\d+)\.(myworkdayjobs|myworkdaysite)\.com$/i;
const WORKDAY_LOCALE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const WORKDAY_SITE_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

export type WorkdayBoardIdentity = {
  tenant: string;
  shard: string;
  baseDomain: "myworkdayjobs.com" | "myworkdaysite.com";
  hostname: string;
  locale: string | null;
  site: string;
  origin: string;
  boardUrl: string;
  boardToken: string;
};

export type WorkdayPublicIdentity = WorkdayBoardIdentity & {
  externalPath: string | null;
  canonicalUrl: string;
};

function decodeSegment(value: string) {
  try { return decodeURIComponent(value); }
  catch { throw new Error("Workday URL contains invalid path encoding"); }
}

function exactWorkdayUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("Workday URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Workday URL must be an exact public HTTPS candidate-site URL");
  }
  return url;
}

export function normalizeWorkdayExternalPath(value: string) {
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.includes("?") || candidate.includes("#") || candidate.includes("\\")) {
    throw new Error("Workday external path is invalid");
  }
  const parts = candidate.split("/").filter(Boolean).map(decodeSegment);
  if (parts.length < 2 || parts[0] !== "job" || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Workday external path is invalid");
  }
  const normalized = `/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
  if (normalized.length > 1200) throw new Error("Workday external path is too long");
  return normalized;
}

export function parseWorkdayPublicUrl(raw: string): WorkdayPublicIdentity {
  const url = exactWorkdayUrl(raw);
  const match = url.hostname.toLowerCase().match(WORKDAY_HOST_PATTERN);
  if (!match) throw new Error("Workday candidate-site host is not supported");
  const tenant = match[1].toLowerCase();
  const shard = match[2].toLowerCase();
  const baseDomain = `${match[3].toLowerCase()}.com` as WorkdayBoardIdentity["baseDomain"];
  const rawParts = url.pathname.split("/").filter(Boolean);
  if (!rawParts.length) throw new Error("Workday candidate-site URL is missing the career site");
  const decoded = rawParts.map(decodeSegment);

  let locale: string | null = null;
  let siteIndex = 0;
  if (WORKDAY_LOCALE_PATTERN.test(decoded[0]) && decoded[1]) {
    locale = decoded[0];
    siteIndex = 1;
  }
  const site = decoded[siteIndex] ?? "";
  if (!WORKDAY_SITE_PATTERN.test(site)) throw new Error("Workday career-site identifier is invalid");

  const trailing = decoded.slice(siteIndex + 1);
  let externalPath: string | null = null;
  if (trailing.length) externalPath = normalizeWorkdayExternalPath(`/${trailing.map((part) => encodeURIComponent(part)).join("/")}`);

  const hostname = `${tenant}.${shard}.${baseDomain}`;
  const boardPath = `/${[locale, site].filter((value): value is string => Boolean(value)).map((part) => encodeURIComponent(part)).join("/")}`;
  const boardUrl = `https://${hostname}${boardPath}`;
  const boardToken = `${hostname}${boardPath}`;
  return {
    tenant,
    shard,
    baseDomain,
    hostname,
    locale,
    site,
    origin: `https://${hostname}`,
    boardUrl,
    boardToken,
    externalPath,
    canonicalUrl: externalPath ? `${boardUrl}${externalPath}` : boardUrl,
  };
}

export function parseWorkdayBoardToken(token: string): WorkdayBoardIdentity {
  const candidate = token.trim();
  if (!candidate || candidate.length > 600 || candidate.includes("://") || /[?#\s]/.test(candidate)) {
    throw new Error("Registered Workday board token is invalid");
  }
  const parsed = parseWorkdayPublicUrl(`https://${candidate}`);
  if (parsed.externalPath) throw new Error("Registered Workday board token must identify a career site, not a job");
  return parsed;
}

export function workdayJobsEndpoint(board: WorkdayBoardIdentity) {
  return `${board.origin}/wday/cxs/${encodeURIComponent(board.tenant)}/${encodeURIComponent(board.site)}/jobs`;
}

export function workdayDetailEndpoint(board: WorkdayBoardIdentity, externalPath: string) {
  return `${board.origin}/wday/cxs/${encodeURIComponent(board.tenant)}/${encodeURIComponent(board.site)}${normalizeWorkdayExternalPath(externalPath)}`;
}
