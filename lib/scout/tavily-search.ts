import type { BraveSearchResult, SearchCostClass } from "./brave-search.ts";

const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const MAX_RESULTS = 20;
const MAX_RESPONSE_BYTES = 1_500_000;
const SEARCH_TIMEOUT_MS = 15_000;

export const TAVILY_SEARCH_CAPABILITIES = Object.freeze({
  webSearch: true,
  fixedServerQueriesOnly: true,
  freeTierFriendly: true,
  fetchResultPages: false,
  scrapeLinkedIn: false,
  scrapePrivateProfiles: false,
  persistResultsByDefault: false,
} as const);

export type TavilySearchProviderOptions = {
  apiKey: string;
  costClass: SearchCostClass;
  allowMeteredSearch?: boolean;
  allowResultPersistence?: boolean;
  fetcher?: typeof fetch;
};

function cleanSecret(value: string) {
  const candidate = value.trim();
  if (candidate.length < 8 || /[\r\n\0]/.test(candidate)) throw new Error("SCOUT_SEARCH_API_KEY is invalid");
  return candidate;
}

function cleanQuery(value: string) {
  const candidate = value.replace(/\s+/g, " ").trim();
  if (!candidate || candidate.length > 400 || candidate.split(" ").filter(Boolean).length > 50) throw new Error("Search query exceeds provider limits");
  return candidate;
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function parseResponse(value: unknown): BraveSearchResult[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Search provider returned an invalid response");
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const normalized: BraveSearchResult[] = [];
  for (const raw of results.slice(0, MAX_RESULTS)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const urlText = cleanText(record.url, 2000);
    let url: URL;
    try { url = new URL(urlText); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    const title = cleanText(record.title, 500);
    if (!title) continue;
    normalized.push({
      url: url.href,
      title,
      description: cleanText(record.content, 2000),
      age: cleanText(record.published_date, 100) || null,
    });
  }
  return [...new Map(normalized.map((item) => [item.url, item])).values()];
}

export function createTavilySearchProvider(options: TavilySearchProviderOptions) {
  const apiKey = cleanSecret(options.apiKey);
  if (options.costClass === "metered" && options.allowMeteredSearch !== true) {
    throw new Error("Metered search is disabled; use included/free capacity or explicitly allow metered search");
  }
  const fetcher = options.fetcher ?? fetch;
  const allowResultPersistence = options.allowResultPersistence === true;

  return Object.freeze({
    provider: "tavily" as const,
    allowResultPersistence,
    async searchFixedQuery(query: string): Promise<BraveSearchResult[]> {
      const response = await fetcher(TAVILY_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          query: cleanQuery(query),
          search_depth: "basic",
          max_results: MAX_RESULTS,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Tavily Search request failed (${response.status})`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) throw new Error("Tavily Search returned a non-JSON response");
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("Tavily Search response exceeded the size limit");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("Tavily Search response exceeded the size limit");
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new Error("Tavily Search returned invalid JSON"); }
      return parseResponse(payload);
    },
  });
}
