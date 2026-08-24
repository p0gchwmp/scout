import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types.ts";

const RECRUITEE_TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const RECRUITEE_SLUG_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;
const RECRUITEE_MAX_POSTINGS = 500;
const RECRUITEE_TIMEOUT_MS = 10_000;
export const RECRUITEE_PUBLIC_JSON_CUTOFF = "2027-02-10T00:00:00.000Z";
const RECRUITEE_PUBLIC_JSON_CUTOFF_MS = Date.parse(RECRUITEE_PUBLIC_JSON_CUTOFF);

function tenant(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!RECRUITEE_TENANT_PATTERN.test(normalized)) throw new Error("Registered Recruitee tenant is invalid");
  return normalized;
}

function offerSlug(value: unknown) {
  const slug = String(value ?? "").trim();
  if (!RECRUITEE_SLUG_PATTERN.test(slug)) throw new Error("Recruitee offer slug is invalid");
  return slug;
}

function htmlText(value: unknown) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function locationText(raw: Record<string, unknown>) {
  const location = raw.location;
  if (typeof location === "string") return location.trim();
  if (location && typeof location === "object" && !Array.isArray(location)) {
    const record = location as Record<string, unknown>;
    return [record.city, record.state ?? record.province, record.country]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  const locations = raw.locations;
  if (Array.isArray(locations)) {
    return locations.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const value = [record.city, record.state ?? record.province, record.country]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(", ");
      return value ? [value] : [];
    }).join(" / ");
  }
  return "";
}

function workplace(raw: Record<string, unknown>): WorkplaceType {
  if (raw.hybrid === true) return "hybrid";
  if (raw.remote === true) return "remote";
  const value = String(raw.work_model ?? raw.workplace_type ?? "").toLowerCase();
  if (value.includes("hybrid")) return "hybrid";
  if (value.includes("remote")) return "remote";
  if (value.includes("on-site") || value.includes("onsite")) return "on-site";
  return "unspecified";
}

function exactCareersUrl(rawTenant: string, rawSlug: string, value: unknown) {
  const expectedTenant = tenant(rawTenant);
  const expectedSlug = offerSlug(rawSlug);
  const fallback = `https://${expectedTenant}.recruitee.com/o/${encodeURIComponent(expectedSlug)}`;
  const url = new URL(String(value ?? fallback).trim());
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
    url.hostname.toLowerCase() !== `${expectedTenant}.recruitee.com` ||
    parts.length !== 2 || parts[0] !== "o" || decodeURIComponent(parts[1]) !== expectedSlug
  ) {
    throw new Error("Recruitee careers URL does not match the requested tenant and offer slug");
  }
  return fallback;
}

function publishedOfferList(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") throw new Error("Recruitee public careers feed returned an invalid payload");
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.offers)) throw new Error("Recruitee public careers feed is missing offers");
  return record.offers;
}

export class RecruiteePublicCareersAdapter implements SourceAdapter {
  readonly source = "recruitee";
  readonly capabilities = {
    discovery: true,
    submission: false,
    publicCandidateSiteOnly: true,
    temporaryUnauthenticatedJsonFeed: true,
    publicJsonAccessSunset: RECRUITEE_PUBLIC_JSON_CUTOFF,
    careersApiToken: false,
    employerApiCredentials: false,
    candidateCreation: false,
  } as const;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private assertPublicFeedWindow() {
    if (this.now() >= RECRUITEE_PUBLIC_JSON_CUTOFF_MS) {
      throw new Error("Recruitee public JSON careers access reached its announced 2027-02-10 token deadline; provider requires a fresh safety review before further use");
    }
  }

  private async fetchOffers(rawTenant: string) {
    this.assertPublicFeedWindow();
    const subdomain = tenant(rawTenant);
    const response = await fetch(`https://${subdomain}.recruitee.com/api/offers`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(RECRUITEE_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status === 404) throw new Error("Recruitee public careers source was not found");
    if (!response.ok) throw new Error(`Recruitee public careers discovery failed (${response.status})`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("json")) throw new Error("Recruitee public careers feed returned non-JSON content");
    const offers = publishedOfferList(await response.json());
    if (offers.length > RECRUITEE_MAX_POSTINGS) throw new Error(`Recruitee source exceeds the ${RECRUITEE_MAX_POSTINGS}-posting safe discovery limit`);
    return { subdomain, offers };
  }

  private normalizeOffer(subdomain: string, value: unknown): NormalizedJob | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw.status && String(raw.status).toLowerCase() !== "published") return null;
    if (raw.kind && String(raw.kind).toLowerCase() !== "job") return null;
    const slug = offerSlug(raw.slug);
    const title = String(raw.title ?? "").trim();
    if (!title) throw new Error("Recruitee offer title is missing");
    const description = [raw.description, raw.requirements]
      .map(htmlText)
      .filter(Boolean)
      .join("\n\n");
    return {
      source: this.source,
      externalId: slug,
      canonicalUrl: exactCareersUrl(subdomain, slug, raw.careers_url),
      company: String(raw.company_name ?? raw.company ?? subdomain).trim() || subdomain,
      title,
      description,
      location: locationText(raw),
      workplaceType: workplace(raw),
      postedAt: raw.published_at ? String(raw.published_at) : raw.created_at ? String(raw.created_at) : undefined,
    };
  }

  async discoverPosting(rawTenant: string, rawOfferSlug: string): Promise<NormalizedJob | null> {
    const expectedSlug = offerSlug(rawOfferSlug);
    const { subdomain, offers } = await this.fetchOffers(rawTenant);
    for (const raw of offers) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      if (String((raw as Record<string, unknown>).slug ?? "").trim() !== expectedSlug) continue;
      return this.normalizeOffer(subdomain, raw);
    }
    return null;
  }

  async discover(rawTenant: string): Promise<NormalizedJob[]> {
    const { subdomain, offers } = await this.fetchOffers(rawTenant);
    const jobs = offers.flatMap((raw) => {
      const job = this.normalizeOffer(subdomain, raw);
      return job ? [job] : [];
    });
    const ids = jobs.map((job) => job.externalId);
    if (new Set(ids).size !== ids.length) throw new Error("Recruitee public careers feed returned duplicate offer slugs");
    return jobs;
  }
}
