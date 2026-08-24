import { AshbyAdapter, GreenhouseAdapter, LeverAdapter, SmartRecruitersAdapter, WorkablePublicAdapter } from "../adapters.ts";
import { BambooHrPublicCareersAdapter } from "../bamboohr-adapter.ts";
import { WorkdayPublicCxsAdapter } from "../workday-adapter.ts";
import {
  validateAshbyEvidenceUrl,
  validateBambooHrEvidenceUrl,
  validateGreenhouseEvidenceUrl,
  validateLeverEvidenceUrl,
  validateSmartRecruitersEvidenceUrl,
  validateWorkableEvidenceUrl,
  validateWorkdayEvidenceUrl,
} from "./contact-extraction.ts";
import { parseWorkdayBoardToken } from "./workday-source.ts";
import type { SyncDiscoveryResult } from "./sync";
import type { AtsProvider, CompanySource } from "./types";

function adapterFor(provider: AtsProvider) {
  switch (provider) {
    case "greenhouse": return new GreenhouseAdapter();
    case "lever": return new LeverAdapter();
    case "ashby": return new AshbyAdapter();
    case "workable": return new WorkablePublicAdapter();
    case "smartrecruiters": return new SmartRecruitersAdapter();
    case "workday": return new WorkdayPublicCxsAdapter();
    case "bamboohr": return new BambooHrPublicCareersAdapter();
  }
}

function validateEvidence(provider: AtsProvider, raw: string, token: string, externalId: string) {
  switch (provider) {
    case "greenhouse": return validateGreenhouseEvidenceUrl(raw, token, externalId);
    case "lever": return validateLeverEvidenceUrl(raw, token, externalId);
    case "ashby": return validateAshbyEvidenceUrl(raw, token, externalId);
    case "workable": return validateWorkableEvidenceUrl(raw, token, externalId);
    case "smartrecruiters": return validateSmartRecruitersEvidenceUrl(raw, token, externalId);
    case "workday": return validateWorkdayEvidenceUrl(raw, token, externalId);
    case "bamboohr": return validateBambooHrEvidenceUrl(raw, token, externalId);
  }
}

export async function discoverRegisteredSource(source: CompanySource): Promise<SyncDiscoveryResult> {
  if (source.provider === "workday") parseWorkdayBoardToken(source.boardToken);
  else if (!/^[A-Za-z0-9._-]{2,100}$/.test(source.boardToken)) throw new Error("Registered ATS source token is invalid");
  const discovered = await adapterFor(source.provider).discover(source.boardToken);
  const normalized = discovered.map((job) => {
    validateEvidence(source.provider, job.canonicalUrl, source.boardToken, job.externalId);
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