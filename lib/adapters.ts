import type { NormalizedJob, SourceAdapter, WorkplaceType } from "./types";

function workplace(value?: string): WorkplaceType {
  const normalized = value?.toLowerCase();
  if (normalized === "remote" || normalized === "hybrid" || normalized === "on-site") return normalized;
  return "unspecified";
}

export class GreenhouseAdapter implements SourceAdapter {
  readonly source = "greenhouse";
  readonly capabilities = { discovery: true, submission: false } as const;
  async discover(boardToken: string): Promise<NormalizedJob[]> {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`);
    if (!response.ok) throw new Error(`Greenhouse discovery failed (${response.status})`);
    const payload = await response.json() as { jobs: Array<Record<string, unknown>> };
    return payload.jobs.map((raw) => ({
      source: this.source,
      externalId: String(raw.id),
      canonicalUrl: String(raw.absolute_url),
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
    const response = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`);
    if (!response.ok) throw new Error(`Lever discovery failed (${response.status})`);
    const payload = await response.json() as Array<Record<string, unknown>>;
    return payload.map((raw) => {
      const categories = raw.categories as { location?: string } | undefined;
      return {
        source: this.source,
        externalId: String(raw.id),
        canonicalUrl: String(raw.hostedUrl),
        company: site,
        title: String(raw.text),
        description: String(raw.descriptionPlain ?? ""),
        location: categories?.location ?? "",
        workplaceType: workplace(String(raw.workplaceType ?? "")),
      };
    });
  }
}
