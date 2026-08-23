import { GreenhouseAdapter, LeverAdapter } from "../adapters";
import { validateGreenhouseEvidenceUrl, validateLeverEvidenceUrl } from "./contact-extraction";
import type { SyncDiscoveryResult } from "./sync";
import type { CompanySource } from "./types";

export async function discoverRegisteredSource(source: CompanySource): Promise<SyncDiscoveryResult> {
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(source.boardToken)) throw new Error("Registered ATS source token is invalid");
  const discovered = source.provider === "greenhouse"
    ? await new GreenhouseAdapter().discover(source.boardToken)
    : await new LeverAdapter().discover(source.boardToken);
  const normalized = discovered.map((job) => {
    if (source.provider === "greenhouse") validateGreenhouseEvidenceUrl(job.canonicalUrl, source.boardToken, job.externalId);
    else validateLeverEvidenceUrl(job.canonicalUrl, source.boardToken, job.externalId);
    return {
      sourceProvider: source.provider,
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

export const discoverGreenhouseSource = discoverRegisteredSource;
