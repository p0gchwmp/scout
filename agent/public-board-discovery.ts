const WWR_RSS_URL = "https://weworkremotely.com/remote-jobs.rss";
const JOOBLE_INDIA_ORIGIN = "https://in.jooble.org";
const MAX_RESPONSE_BYTES = 1_000_000;
const SOURCE_TIMEOUT_MS = 10_000;
const MAX_WWR_LEADS = 30;
const MAX_JOOBLE_LEADS = 30;

const EARLY_CAREER_PATTERN = /\b(?:intern|internship|trainee|apprentice|co-?op|graduate|new grad|entry[- ]?level|student|junior)\b/i;
const ROLE_FAMILY_PATTERN = /\b(?:product|operations?|business|strategy|finance|financial|econom(?:ics|ist)?|analyst|analytics|data|research|policy|health|implementation|solutions?|quality|qa|project|program|growth|marketing|customer success|technical|systems?)\b/i;

export const PUBLIC_BOARD_DISCOVERY_CAPABILITIES = Object.freeze({
  fixedSourcesOnly: true,
  weWorkRemotelyRss: true,
  joobleIndiaApi: true,
  joobleOptInOnly: true,
  joobleMaxRequestsPerRun: 1,
  arbitraryUrlFetch: false,
  profileScrape: false,
  privateContactScrape: false,
  sendEmail: false,
  submitApplication: false,
} as const);

export type PublicBoardDiscoveryLead = {
  provider: "public_board";
  canonicalUrl: string;
  company: string;
  title: string;
  sourceUrl: string;
  focus: string;
  location: string;
  postedAt: string | null;
  platformId: "weworkremotely" | "jooble";
  nextStep: string;
};

export type PublicBoardDiscoveryResult = {
  leads: PublicBoardDiscoveryLead[];
  failures: Array<{ company: string; provider: string; reason: string }>;
  modes: {
    weWorkRemotelyRss: true;
    joobleApi: boolean;
  };
};

function decodeXml(value: string) {
  const withoutCdata = value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1");
  return withoutCdata
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      try { return String.fromCodePoint(Number.parseInt(hex, 16)); }
      catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, decimal: string) => {
      try { return String.fromCodePoint(Number.parseInt(decimal, 10)); }
      catch { return ""; }
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlText(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  return match?.[1] ? decodeXml(match[1].trim()).trim() : "";
}

function textOnly(value: string) {
  return decodeXml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function httpsUrl(value: string, allowedHost?: RegExp) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (allowedHost && !allowedHost.test(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isoDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function relevantEarlyCareer(text: string) {
  return EARLY_CAREER_PATTERN.test(text) && ROLE_FAMILY_PATTERN.test(text);
}

function wwrLeadsFromXml(xml: string): PublicBoardDiscoveryLead[] {
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const leads: PublicBoardDiscoveryLead[] = [];
  for (const rawBlock of blocks) {
    if (leads.length >= MAX_WWR_LEADS) break;
    const titleLine = textOnly(xmlText(rawBlock, "title"));
    const description = textOnly(xmlText(rawBlock, "description"));
    const category = textOnly(xmlText(rawBlock, "category"));
    const type = textOnly(xmlText(rawBlock, "type"));
    if (!titleLine || !relevantEarlyCareer(`${titleLine} ${description} ${category} ${type}`)) continue;

    const titleMatch = titleLine.match(/^([^:]{1,200}):\s*(.{1,300})$/);
    const creator = textOnly(xmlText(rawBlock, "dc:creator"));
    const company = (titleMatch?.[1] ?? creator).trim().slice(0, 200);
    const title = (titleMatch?.[2] ?? titleLine).trim().slice(0, 300);
    if (!company || !title) continue;

    const canonicalUrl = httpsUrl(xmlText(rawBlock, "link"), /(^|\.)weworkremotely\.com$/i);
    if (!canonicalUrl) continue;
    const region = textOnly(xmlText(rawBlock, "region"));
    const country = textOnly(xmlText(rawBlock, "country"));
    const location = [region, country].filter(Boolean).join(" / ") || "Remote";
    const postedAt = isoDate(xmlText(rawBlock, "pubDate"));

    leads.push({
      provider: "public_board",
      canonicalUrl,
      company,
      title,
      sourceUrl: WWR_RSS_URL,
      focus: "Remote early-career lead from the official We Work Remotely public RSS feed",
      location,
      postedAt,
      platformId: "weworkremotely",
      nextStep: "Resolve the employer and an official company/ATS posting before application preparation or outreach research.",
    });
  }
  return leads;
}

async function readBoundedResponse(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("response too large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("response too large");
  return text;
}

async function discoverWeWorkRemotely(fetcher: typeof fetch) {
  const response = await fetcher(WWR_RSS_URL, {
    headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "ScoutInternshipDiscovery/1.0" },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`WWR RSS failed (${response.status})`);
  return wwrLeadsFromXml(await readBoundedResponse(response));
}

type JoobleJob = {
  title?: unknown;
  location?: unknown;
  snippet?: unknown;
  source?: unknown;
  type?: unknown;
  link?: unknown;
  company?: unknown;
  updated?: unknown;
};

function joobleLeadsFromPayload(payload: unknown): PublicBoardDiscoveryLead[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid Jooble payload");
  const jobs = (payload as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) throw new Error("invalid Jooble jobs payload");
  const leads: PublicBoardDiscoveryLead[] = [];
  for (const rawValue of jobs) {
    if (leads.length >= MAX_JOOBLE_LEADS) break;
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
    const raw = rawValue as JoobleJob;
    const title = textOnly(String(raw.title ?? "")).slice(0, 300);
    const snippet = textOnly(String(raw.snippet ?? ""));
    const type = textOnly(String(raw.type ?? ""));
    if (!title || !relevantEarlyCareer(`${title} ${snippet} ${type}`)) continue;
    const company = textOnly(String(raw.company ?? "")).slice(0, 200);
    const canonicalUrl = httpsUrl(String(raw.link ?? ""));
    if (!company || !canonicalUrl) continue;
    leads.push({
      provider: "public_board",
      canonicalUrl,
      company,
      title,
      sourceUrl: `${JOOBLE_INDIA_ORIGIN}/`,
      focus: "India early-career aggregator lead from the opt-in Jooble REST API",
      location: textOnly(String(raw.location ?? "")).slice(0, 500),
      postedAt: isoDate(String(raw.updated ?? "")),
      platformId: "jooble",
      nextStep: "Treat Jooble as a lead only; resolve the original employer and official company/ATS posting before application preparation or outreach research.",
    });
  }
  return leads;
}

async function discoverJoobleIndia(apiKey: string, fetcher: typeof fetch) {
  const endpoint = `${JOOBLE_INDIA_ORIGIN}/api/${encodeURIComponent(apiKey)}`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      keywords: "internship",
      location: "India",
      page: 1,
      ResultOnPage: 50,
      companysearch: false,
    }),
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Jooble API failed (${response.status})`);
  const text = await readBoundedResponse(response);
  try { return joobleLeadsFromPayload(JSON.parse(text)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error("Jooble API returned invalid JSON");
    throw error;
  }
}

function stableFailure(provider: "weworkremotely" | "jooble", error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/429/.test(message)) return `${provider} rate-limited this Scout run`;
  if (/timeout|timed out|abort/i.test(message)) return `${provider} timed out this Scout run`;
  if (/response too large/i.test(message)) return `${provider} returned more data than Scout's bounded source limit`;
  return `${provider} was temporarily unavailable`;
}

export async function discoverPublicBoardInternships(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<PublicBoardDiscoveryResult> {
  const joobleEnabled = environment.SCOUT_JOOBLE_ENABLED === "1";
  const joobleKey = environment.SCOUT_JOOBLE_API_KEY?.trim() ?? "";
  const leads: PublicBoardDiscoveryLead[] = [];
  const failures: PublicBoardDiscoveryResult["failures"] = [];

  const tasks: Array<{ provider: "weworkremotely" | "jooble"; company: string; run: () => Promise<PublicBoardDiscoveryLead[]> }> = [
    { provider: "weworkremotely", company: "We Work Remotely", run: () => discoverWeWorkRemotely(fetcher) },
  ];
  if (joobleEnabled && joobleKey) {
    tasks.push({ provider: "jooble", company: "Jooble India", run: () => discoverJoobleIndia(joobleKey, fetcher) });
  } else if (joobleEnabled) {
    failures.push({ company: "Jooble India", provider: "jooble", reason: "Jooble is enabled but SCOUT_JOOBLE_API_KEY is not configured" });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  settled.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === "fulfilled") leads.push(...result.value);
    else failures.push({ company: task.company, provider: task.provider, reason: stableFailure(task.provider, result.reason) });
  });

  const deduped = [...new Map(leads.map((lead) => [lead.canonicalUrl, lead])).values()];
  return {
    leads: deduped,
    failures,
    modes: { weWorkRemotelyRss: true, joobleApi: joobleEnabled },
  };
}
