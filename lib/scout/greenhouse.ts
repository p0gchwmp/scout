import { GreenhouseAdapter } from "../adapters";
import { validateGreenhouseEvidenceUrl } from "./contact-extraction";
import type { SyncDiscoveryResult } from "./sync";
import type { CompanySource } from "./types";

export async function discoverGreenhouseSource(source: CompanySource): Promise<SyncDiscoveryResult> {
  if (source.provider !== "greenhouse") throw new Error("Only Greenhouse sources are supported");
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(source.boardToken)) throw new Error("Registered Greenhouse board token is invalid");
  const discovered = await new GreenhouseAdapter().discover(source.boardToken);
  const normalized = discovered.map((job) => {
    validateGreenhouseEvidenceUrl(job.canonicalUrl, source.boardToken, job.externalId);
    return {
      sourceProvider: "greenhouse" as const,
      externalId: job.externalId,
      canonicalUrl: job.canonicalUrl,
      company: source.companyName,
      title: job.title,
      description: job.description,
      location: job.location,
      workplaceType: job.workplaceType,
      score: 0,
      scoreExplanation: ["Unranked: approved profile not configured"],
      eligibilityRisks: [],
      postedAt: job.postedAt,
    };
  });
  return { jobs: normalized, complete: true };
}
