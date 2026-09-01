import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types";

function workplace(value?: string): WorkplaceType {
  const normalized = value?.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized === "remote" || normalized === "hybrid") return normalized;
  if (normalized === "on-site" || normalized === "onsite") return "on-site";
  return "unspecified";
}

function httpsUrl(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${field} must be a public HTTPS URL`);
  return url.href;
}

function workableCanonicalJobUrl(raw: Record<string, unknown>, externalId: string) {
  for (const candidate of [raw.shortlink, raw.application_url, raw.url]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.hostname.toLowerCase() !== "apply.workable.com") continue;
    const parts = url.pathname.split("/").filter(Boolean);
    const currentShortlink = parts.length === 2 && parts[0] === "j" && parts[1] === externalId;
    const legacySlugged = parts.length === 3 && parts[1] === "j" && parts[2] === externalId;
    if (currentShortlink || legacySlugged) return url.href;
  }
  throw new Error("Workable discovery did not return a trusted exact job-page URL for its shortcode");
}

function htmlText(value: unknown) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export class GreenhouseAdapter implements SourceAdapter {
  readonly source = "greenhouse";
  readonly capabilities = { discovery: true, submission: false } as const;
  async discover(boardToken: string): Promise<NormalizedJob[]> {
    const endpoint = new URL(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs`);
    endpoint.searchParams.set("content", "true");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Greenhouse discovery failed (${response.status})`);
    const payload = await response.json() as { jobs?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.jobs)) throw new Error("Greenhouse discovery returned an invalid jobs payload");
    return payload.jobs.map((raw) => ({
      source: this.source,
      externalId: String(raw.id),
      canonicalUrl: httpsUrl(raw.absolute_url, "Greenhouse job URL"),
      company: boardToken,
      title: String(raw.title),
      description: htmlText(raw.content),
      location: String((raw.location as { name?: string })?.name ?? ""),
      workplaceType: workplace(),
      postedAt: raw.updated_at ? String(raw.updated_at) : undefined,
    }));
  }
}

export class LeverAdapter implements SourceAdapter {
  readonly source = "lever";
  readonly capabilities = { discovery: true, submission: false } as const;
  async discover(site: string): Promise<NormalizedJob[]> {
    const endpoint = new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}`);
    endpoint.searchParams.set("mode", "json");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Lever discovery failed (${response.status})`);
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) throw new Error("Lever discovery returned an invalid postings payload");
    return (payload as Array<Record<string, unknown>>).map((raw) => {
      const categories = raw.categories as { location?: string } | undefined;
      return {
        source: this.source,
        externalId: String(raw.id),
        canonicalUrl: httpsUrl(raw.hostedUrl, "Lever job URL"),
        company: site,
        title: String(raw.text),
        description: String(raw.descriptionPlain ?? ""),
        location: categories?.location ?? "",
        workplaceType: workplace(String(raw.workplaceType ?? "")),
      };
    });
  }
}

export class AshbyAdapter implements SourceAdapter {
  readonly source = "ashby";
  readonly capabilities = { discovery: true, submission: false } as const;
  async discover(jobBoardName: string): Promise<NormalizedJob[]> {
    const endpoint = new URL(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(jobBoardName)}`);
    endpoint.searchParams.set("includeCompensation", "false");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Ashby discovery failed (${response.status})`);
    const payload = await response.json() as { apiVersion?: unknown; jobs?: unknown };
    if (payload.apiVersion !== "1" || !Array.isArray(payload.jobs)) throw new Error("Ashby discovery returned an invalid jobs payload");
    return payload.jobs.flatMap((rawValue) => {
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return [];
      const raw = rawValue as Record<string, unknown>;
      if (raw.isListed === false) return [];
      const jobUrl = httpsUrl(raw.jobUrl, "Ashby job URL");
      const parsed = new URL(jobUrl);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const externalId = parts.at(-1) ?? "";
      if (!externalId) throw new Error("Ashby job URL did not contain a posting id");
      return [{
        source: this.source,
        externalId,
        canonicalUrl: jobUrl,
        company: jobBoardName,
        title: String(raw.title ?? ""),
        description: String(raw.descriptionPlain ?? ""),
        location: String(raw.location ?? ""),
        workplaceType: workplace(String(raw.workplaceType ?? (raw.isRemote === true ? "Remote" : ""))),
        postedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
      } satisfies NormalizedJob];
    });
  }
}

export class WorkablePublicAdapter implements SourceAdapter {
  readonly source = "workable";
  readonly capabilities = { discovery: true, submission: false } as const;
  async discover(subdomain: string): Promise<NormalizedJob[]> {
    const endpoint = new URL(`https://www.workable.com/api/accounts/${encodeURIComponent(subdomain)}`);
    endpoint.searchParams.set("details", "true");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Workable public discovery failed (${response.status})`);
    const payload = await response.json() as { name?: unknown; jobs?: unknown };
    if (!Array.isArray(payload.jobs)) throw new Error("Workable public discovery returned an invalid jobs payload");
    return payload.jobs.flatMap((rawValue) => {
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return [];
      const raw = rawValue as Record<string, unknown>;
      const externalId = String(raw.shortcode ?? raw.code ?? "").trim();
      if (!externalId) return [];
      const canonicalUrl = workableCanonicalJobUrl(raw, externalId);
      const location = [raw.city, raw.state, raw.country].map((value) => String(value ?? "").trim()).filter(Boolean).join(", ");
      return [{
        source: this.source,
        externalId,
        canonicalUrl,
        company: String(payload.name ?? subdomain),
        title: String(raw.title ?? ""),
        description: String(raw.description ?? ""),
        location,
        workplaceType: workplace(String(raw.workplace_type ?? (raw.telecommuting === true ? "remote" : ""))),
        postedAt: raw.published_on ? String(raw.published_on) : undefined,
      } satisfies NormalizedJob];
    });
  }
}

const SMARTRECRUITERS_PAGE_SIZE = 100;
const SMARTRECRUITERS_MAX_POSTINGS = 500;
const SMARTRECRUITERS_DETAIL_CONCURRENCY = 8;
const SMARTRECRUITERS_INTERNSHIP_PATTERN = /\b(intern|internship|trainee|apprentice|co-?op)\b/i;

type SmartRecruitersPostingList = {
  totalFound?: unknown;
  content?: unknown;
};

function smartRecruitersDescription(raw: Record<string, unknown>) {
  const jobAd = raw.jobAd;
  if (!jobAd || typeof jobAd !== "object" || Array.isArray(jobAd)) return "";
  const sections = (jobAd as Record<string, unknown>).sections;
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) return "";
  const sectionMap = sections as Record<string, unknown>;
  return ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
    .map((key) => sectionMap[key])
    .flatMap((section) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) return [];
      return [htmlText((section as Record<string, unknown>).text)];
    })
    .filter(Boolean)
    .join("\n\n");
}

export class SmartRecruitersAdapter implements SourceAdapter {
  readonly source = "smartrecruiters";
  readonly capabilities = { discovery: true, submission: false } as const;

  async discoverPosting(companyIdentifier: string, postingId: string): Promise<NormalizedJob | null> {
    const endpoint = new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyIdentifier)}/postings/${encodeURIComponent(postingId)}`);
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`SmartRecruiters posting discovery failed (${response.status})`);
    const payload = await response.json() as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("SmartRecruiters posting discovery returned an invalid payload");
    const raw = payload as Record<string, unknown>;
    if (raw.active === false) return null;
    const company = raw.company as { identifier?: unknown; name?: unknown } | undefined;
    if (String(company?.identifier ?? "") !== companyIdentifier) throw new Error("SmartRecruiters posting company identifier did not match the requested source");
    const externalId = String(raw.id ?? "").trim();
    if (!externalId) throw new Error("SmartRecruiters posting did not contain an id");
    const location = raw.location as { city?: unknown; region?: unknown; country?: unknown; remote?: unknown } | undefined;
    return {
      source: this.source,
      externalId,
      canonicalUrl: httpsUrl(raw.postingUrl, "SmartRecruiters posting URL"),
      company: String(company?.name ?? companyIdentifier),
      title: String(raw.name ?? ""),
      description: smartRecruitersDescription(raw),
      location: [location?.city, location?.region, location?.country].map((value) => String(value ?? "").trim()).filter(Boolean).join(", "),
      workplaceType: workplace(location?.remote === true ? "remote" : ""),
      postedAt: raw.releasedDate ? String(raw.releasedDate) : undefined,
    };
  }

  private async discoverPostingIds(companyIdentifier: string, internshipOnly: boolean) {
    const postingIds: string[] = [];
    let offset = 0;
    let expectedTotal: number | null = null;

    while (expectedTotal === null || offset < expectedTotal) {
      const endpoint = new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyIdentifier)}/postings`);
      endpoint.searchParams.set("destination", "PUBLIC");
      endpoint.searchParams.set("limit", String(SMARTRECRUITERS_PAGE_SIZE));
      endpoint.searchParams.set("offset", String(offset));
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`SmartRecruiters discovery failed (${response.status})`);
      const payload = await response.json() as SmartRecruitersPostingList;
      if (!Array.isArray(payload.content) || !Number.isInteger(payload.totalFound) || (payload.totalFound as number) < 0) {
        throw new Error("SmartRecruiters discovery returned an invalid postings payload");
      }
      expectedTotal = payload.totalFound as number;
      if (expectedTotal > SMARTRECRUITERS_MAX_POSTINGS) {
        throw new Error(`SmartRecruiters source exceeds the ${SMARTRECRUITERS_MAX_POSTINGS}-posting safe discovery limit`);
      }
      for (const item of payload.content) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const posting = item as Record<string, unknown>;
        const id = String(posting.id ?? "").trim();
        const title = String(posting.name ?? "");
        if (id && (!internshipOnly || SMARTRECRUITERS_INTERNSHIP_PATTERN.test(title))) postingIds.push(id);
      }
      if (payload.content.length === 0) break;
      offset += payload.content.length;
    }

    return [...new Set(postingIds)];
  }

  private async discoverDetails(companyIdentifier: string, postingIds: string[]) {
    const jobs: NormalizedJob[] = [];
    for (let index = 0; index < postingIds.length; index += SMARTRECRUITERS_DETAIL_CONCURRENCY) {
      const batch = postingIds.slice(index, index + SMARTRECRUITERS_DETAIL_CONCURRENCY);
      const details = await Promise.all(batch.map((postingId) => this.discoverPosting(companyIdentifier, postingId)));
      for (const job of details) if (job) jobs.push(job);
    }
    return jobs;
  }

  async discover(companyIdentifier: string): Promise<NormalizedJob[]> {
    return this.discoverDetails(companyIdentifier, await this.discoverPostingIds(companyIdentifier, false));
  }

  async discoverInternships(companyIdentifier: string): Promise<NormalizedJob[]> {
    return this.discoverDetails(companyIdentifier, await this.discoverPostingIds(companyIdentifier, true));
  }
}
