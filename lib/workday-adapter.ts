import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types.ts";
import {
  normalizeWorkdayExternalPath,
  parseWorkdayBoardToken,
  workdayDetailEndpoint,
  workdayJobsEndpoint,
  type WorkdayBoardIdentity,
} from "./scout/workday-source.ts";

const WORKDAY_PAGE_SIZE = 20;
const WORKDAY_MAX_POSTINGS = 120;
const WORKDAY_DETAIL_CONCURRENCY = 4;
const WORKDAY_TIMEOUT_MS = 10_000;

function htmlText(value: unknown) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function workplaceFromText(value: string): WorkplaceType {
  if (/\bhybrid\b/i.test(value)) return "hybrid";
  if (/\bremote\b/i.test(value)) return "remote";
  return "unspecified";
}

function workdayHeaders(board: WorkdayBoardIdentity, includeJsonBody = false) {
  return {
    accept: "application/json",
    "accept-language": "en-US",
    referer: board.boardUrl,
    ...(includeJsonBody ? { "content-type": "application/json" } : {}),
  };
}

async function jsonResponse(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("json")) throw new Error(`${label} returned non-JSON content`);
  return response.json() as Promise<unknown>;
}

function additionalLocationText(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item.trim()];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const text = String(record.location ?? record.name ?? record.label ?? "").trim();
    return text ? [text] : [];
  });
}

export class WorkdayPublicCxsAdapter implements SourceAdapter {
  readonly source = "workday";
  readonly capabilities = {
    discovery: true,
    submission: false,
    publicCandidateSiteOnly: true,
    undocumentedCandidateSurface: true,
    tenantGuessing: false,
  } as const;

  async discoverPosting(boardToken: string, externalPath: string): Promise<NormalizedJob | null> {
    const board = parseWorkdayBoardToken(boardToken);
    const normalizedPath = normalizeWorkdayExternalPath(externalPath);
    const response = await fetch(workdayDetailEndpoint(board, normalizedPath), {
      method: "GET",
      headers: workdayHeaders(board),
      signal: AbortSignal.timeout(WORKDAY_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status === 404) return null;
    const payload = await jsonResponse(response, "Workday posting discovery");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Workday posting discovery returned an invalid payload");
    const info = (payload as Record<string, unknown>).jobPostingInfo;
    if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error("Workday posting detail is missing jobPostingInfo");
    const raw = info as Record<string, unknown>;
    const title = String(raw.title ?? "").trim();
    if (!title) throw new Error("Workday posting title is missing");
    const description = htmlText(raw.jobDescription);
    const locations = [String(raw.location ?? "").trim(), ...additionalLocationText(raw.additionalLocations)].filter(Boolean);
    const location = [...new Set(locations)].join(" / ");
    return {
      source: this.source,
      externalId: normalizedPath,
      canonicalUrl: `${board.boardUrl}${normalizedPath}`,
      company: board.tenant,
      title,
      description,
      location,
      workplaceType: workplaceFromText(location),
    };
  }

  async discover(boardToken: string): Promise<NormalizedJob[]> {
    const board = parseWorkdayBoardToken(boardToken);
    const externalPaths: string[] = [];
    let offset = 0;
    let expectedTotal: number | null = null;

    while (expectedTotal === null || offset < expectedTotal) {
      const response = await fetch(workdayJobsEndpoint(board), {
        method: "POST",
        headers: workdayHeaders(board, true),
        body: JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE_SIZE, offset, searchText: "" }),
        signal: AbortSignal.timeout(WORKDAY_TIMEOUT_MS),
        redirect: "error",
      });
      const payload = await jsonResponse(response, "Workday board discovery");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Workday board discovery returned an invalid payload");
      const record = payload as Record<string, unknown>;
      if (!Array.isArray(record.jobPostings) || !Number.isInteger(record.total) || (record.total as number) < 0) {
        throw new Error("Workday board discovery returned an invalid jobs payload");
      }
      if (expectedTotal === null) {
        expectedTotal = record.total as number;
        if (expectedTotal > WORKDAY_MAX_POSTINGS) {
          throw new Error(`Workday source exceeds the ${WORKDAY_MAX_POSTINGS}-posting safe discovery limit; use exact-posting resolution instead`);
        }
      }
      const page = record.jobPostings as Array<unknown>;
      if (!page.length && offset < expectedTotal) throw new Error("Workday board discovery ended before the advertised total; refusing a partial sync");
      for (const item of page) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const path = String((item as Record<string, unknown>).externalPath ?? "").trim();
        if (path) externalPaths.push(normalizeWorkdayExternalPath(path));
      }
      offset += page.length;
      if (!page.length) break;
    }

    const uniquePaths = [...new Set(externalPaths)];
    if (expectedTotal !== null && uniquePaths.length < expectedTotal) {
      throw new Error("Workday board discovery did not return every advertised posting; refusing a partial sync");
    }

    const jobs: NormalizedJob[] = [];
    for (let index = 0; index < uniquePaths.length; index += WORKDAY_DETAIL_CONCURRENCY) {
      const batch = uniquePaths.slice(index, index + WORKDAY_DETAIL_CONCURRENCY);
      const details = await Promise.all(batch.map((externalPath) => this.discoverPosting(boardToken, externalPath)));
      for (const job of details) if (job) jobs.push(job);
    }
    if (jobs.length !== uniquePaths.length) throw new Error("A Workday posting disappeared during board sync; refusing a partial snapshot set");
    return jobs;
  }
}
