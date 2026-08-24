import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types.ts";

const BAMBOOHR_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const BAMBOOHR_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const BAMBOOHR_MAX_POSTINGS = 250;
const BAMBOOHR_DETAIL_CONCURRENCY = 4;
const BAMBOOHR_TIMEOUT_MS = 10_000;

function tenantSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!BAMBOOHR_SLUG_PATTERN.test(slug)) throw new Error("Registered BambooHR tenant slug is invalid");
  return slug;
}

function jobId(value: string) {
  const id = value.trim();
  if (!BAMBOOHR_JOB_ID_PATTERN.test(id)) throw new Error("BambooHR job id is invalid");
  return id;
}

function htmlText(value: unknown) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function workplaceType(raw: Record<string, unknown>): WorkplaceType {
  const locationType = String(raw.locationType ?? "").trim();
  if (locationType === "1" || raw.isRemote === true) return "remote";
  if (locationType === "2") return "hybrid";
  if (locationType === "0") return "on-site";
  return "unspecified";
}

function locationText(raw: Record<string, unknown>) {
  const candidates = [raw.location, raw.atsLocation];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const values = [record.city, record.state ?? record.province, record.country]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (values.length) return [...new Set(values)].join(", ");
  }
  return "";
}

function exactPostingUrl(slug: string, id: string, value?: unknown) {
  const fallback = `https://${slug}.bamboohr.com/careers/${encodeURIComponent(id)}`;
  const text = String(value ?? fallback).trim();
  const url = new URL(text);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
    url.hostname.toLowerCase() !== `${slug}.bamboohr.com` ||
    parts.length !== 2 || parts[0] !== "careers" || decodeURIComponent(parts[1]) !== id
  ) {
    throw new Error("BambooHR public posting URL does not match the requested tenant and job id");
  }
  return `https://${slug}.bamboohr.com/careers/${encodeURIComponent(id)}`;
}

async function fetchJson(url: string, label: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(BAMBOOHR_TIMEOUT_MS),
    redirect: "error",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("json")) throw new Error(`${label} returned non-JSON content`);
  return response.json() as Promise<unknown>;
}

export class BambooHrPublicCareersAdapter implements SourceAdapter {
  readonly source = "bamboohr";
  readonly capabilities = {
    discovery: true,
    submission: false,
    publicCandidateSiteOnly: true,
    undocumentedCandidateSurface: true,
    employerApiCredentials: false,
    tenantGuessing: false,
  } as const;

  async discoverPosting(rawSlug: string, rawJobId: string): Promise<NormalizedJob | null> {
    const slug = tenantSlug(rawSlug);
    const id = jobId(rawJobId);
    const payload = await fetchJson(`https://${slug}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`, "BambooHR posting discovery");
    if (payload === null) return null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("BambooHR posting discovery returned an invalid payload");
    const result = (payload as Record<string, unknown>).result;
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("BambooHR posting discovery is missing result");
    const opening = (result as Record<string, unknown>).jobOpening;
    if (!opening || typeof opening !== "object" || Array.isArray(opening)) throw new Error("BambooHR posting discovery is missing jobOpening");
    const raw = opening as Record<string, unknown>;
    const title = String(raw.jobOpeningName ?? "").trim();
    if (!title) throw new Error("BambooHR posting title is missing");
    return {
      source: this.source,
      externalId: id,
      canonicalUrl: exactPostingUrl(slug, id, raw.jobOpeningShareUrl),
      company: slug,
      title,
      description: htmlText(raw.description),
      location: locationText(raw),
      workplaceType: workplaceType(raw),
      postedAt: raw.datePosted ? String(raw.datePosted) : undefined,
    };
  }

  async discover(rawSlug: string): Promise<NormalizedJob[]> {
    const slug = tenantSlug(rawSlug);
    const payload = await fetchJson(`https://${slug}.bamboohr.com/careers/list`, "BambooHR board discovery");
    if (payload === null) throw new Error("BambooHR public careers source was not found");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("BambooHR board discovery returned an invalid payload");
    const record = payload as Record<string, unknown>;
    const meta = record.meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta) || !Array.isArray(record.result)) {
      throw new Error("BambooHR board discovery returned an invalid jobs payload");
    }
    const totalCount = Number((meta as Record<string, unknown>).totalCount);
    if (!Number.isInteger(totalCount) || totalCount < 0 || totalCount !== record.result.length) {
      throw new Error("BambooHR board discovery count did not match the returned postings");
    }
    if (totalCount > BAMBOOHR_MAX_POSTINGS) {
      throw new Error(`BambooHR source exceeds the ${BAMBOOHR_MAX_POSTINGS}-posting safe discovery limit; use exact-posting resolution instead`);
    }
    const ids = record.result.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const id = String((item as Record<string, unknown>).id ?? "").trim();
      return id ? [jobId(id)] : [];
    });
    if (new Set(ids).size !== ids.length) throw new Error("BambooHR board discovery returned duplicate job ids");

    const jobs: NormalizedJob[] = [];
    for (let index = 0; index < ids.length; index += BAMBOOHR_DETAIL_CONCURRENCY) {
      const batch = ids.slice(index, index + BAMBOOHR_DETAIL_CONCURRENCY);
      const details = await Promise.all(batch.map((id) => this.discoverPosting(slug, id)));
      for (const job of details) if (job) jobs.push(job);
    }
    if (jobs.length !== ids.length) throw new Error("A BambooHR posting disappeared during board sync; refusing a partial snapshot set");
    return jobs;
  }
}
