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
      description: String(raw.content ?? "").replace(/<[^>]+>/g, " "),
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
      const canonicalUrl = httpsUrl(raw.application_url ?? raw.shortlink, "Workable job URL");
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
