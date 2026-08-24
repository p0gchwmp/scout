import { AshbyAdapter, GreenhouseAdapter, LeverAdapter, SmartRecruitersAdapter, WorkablePublicAdapter } from "../adapters.ts";
import { BambooHrPublicCareersAdapter } from "../bamboohr-adapter.ts";
import { parseBreezyPublicJobUrl, BreezyOfficialPageAdapter } from "../breezy-adapter.ts";
import { RecruiteePublicCareersAdapter } from "../recruitee-adapter.ts";
import { parseTeamtailorPublicJobUrl, TeamtailorOfficialPageAdapter } from "../teamtailor-adapter.ts";
import { WorkdayPublicCxsAdapter } from "../workday-adapter.ts";
import {
  validateAshbyEvidenceUrl,
  validateBambooHrEvidenceUrl,
  validateBreezyEvidenceUrl,
  validateGreenhouseEvidenceUrl,
  validateLeverEvidenceUrl,
  validateRecruiteeEvidenceUrl,
  validateSmartRecruitersEvidenceUrl,
  validateTeamtailorEvidenceUrl,
  validateWorkableEvidenceUrl,
  validateWorkdayEvidenceUrl,
} from "./contact-extraction.ts";
import { CONTROLLED_DISCOVERY_SOURCES } from "./lead-discovery.ts";
import { snapshotHash } from "./sync.ts";
import type { AtsProvider } from "./types.ts";
import { parseWorkdayPublicUrl } from "./workday-source.ts";

export const LEAD_RESOLUTION_CAPABILITIES = Object.freeze({
  controlledSourcesOnly: true,
  greenhouse: true,
  lever: true,
  ashby: true,
  workable: true,
  smartrecruiters: true,
  workday: true,
  bamboohr: true,
  recruitee: true,
  teamtailor: true,
  breezy: true,
  arbitraryUrlFetch: false,
  submit: false,
  send: false,
} as const);

const SMARTRECRUITERS_POSTING_SEGMENT = /^([0-9]{4,32})(?:-|$)/;
const BAMBOOHR_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.bamboohr\.com$/i;
const RECRUITEE_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.recruitee\.com$/i;

function exactHttpsUrl(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Lead URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Lead URL is not an exact supported HTTPS posting URL");
  }
  return url;
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
    case "recruitee": return validateRecruiteeEvidenceUrl(raw, token, externalId);
    case "teamtailor": return validateTeamtailorEvidenceUrl(raw, token, externalId);
    case "breezy": return validateBreezyEvidenceUrl(raw, token, externalId);
  }
}

async function discover(provider: AtsProvider, token: string, externalId: string) {
  switch (provider) {
    case "greenhouse": return new GreenhouseAdapter().discover(token);
    case "lever": return new LeverAdapter().discover(token);
    case "ashby": return new AshbyAdapter().discover(token);
    case "workable": return new WorkablePublicAdapter().discover(token);
    case "smartrecruiters": {
      const job = await new SmartRecruitersAdapter().discoverPosting(token, externalId);
      return job ? [job] : [];
    }
    case "workday": {
      const job = await new WorkdayPublicCxsAdapter().discoverPosting(token, externalId);
      return job ? [job] : [];
    }
    case "bamboohr": {
      const job = await new BambooHrPublicCareersAdapter().discoverPosting(token, externalId);
      return job ? [job] : [];
    }
    case "recruitee": {
      const job = await new RecruiteePublicCareersAdapter().discoverPosting(token, externalId);
      return job ? [job] : [];
    }
    case "teamtailor": {
      const job = await new TeamtailorOfficialPageAdapter().discoverPosting(token, externalId);
      return job ? [job] : [];
    }
    case "breezy": {
      const job = await new BreezyOfficialPageAdapter().discoverPosting(token, externalId);
      return job ? [job] : [];
    }
  }
}

export async function resolveControlledLead(canonicalUrl: string) {
  const url = exactHttpsUrl(canonicalUrl);
  const hostname = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  let provider: AtsProvider;
  let slug: string;
  let externalId: string;

  if (["job-boards.greenhouse.io", "boards.greenhouse.io"].includes(hostname) && parts.length === 3 && parts[1] === "jobs") {
    provider = "greenhouse";
    slug = parts[0];
    externalId = parts[2];
  } else if (hostname === "jobs.lever.co" && parts.length === 2) {
    provider = "lever";
    slug = parts[0];
    externalId = parts[1];
  } else if (hostname === "jobs.ashbyhq.com" && parts.length === 2) {
    provider = "ashby";
    slug = parts[0];
    externalId = parts[1];
  } else if (hostname === "apply.workable.com" && parts.length === 3 && parts[1] === "j") {
    provider = "workable";
    slug = parts[0];
    externalId = parts[2];
  } else if (hostname === "jobs.smartrecruiters.com" && parts.length === 2) {
    const match = parts[1].match(SMARTRECRUITERS_POSTING_SEGMENT);
    if (!match) throw new Error("Lead resolution is not supported for this application channel yet");
    provider = "smartrecruiters";
    slug = parts[0];
    externalId = match[1];
  } else if (hostname.endsWith(".myworkdayjobs.com") || hostname.endsWith(".myworkdaysite.com")) {
    const parsed = parseWorkdayPublicUrl(url.href);
    if (!parsed.externalPath) throw new Error("Lead resolution requires an exact Workday job posting");
    provider = "workday";
    slug = parsed.boardToken;
    externalId = parsed.externalPath;
  } else if (hostname.endsWith(".teamtailor.com")) {
    const parsed = parseTeamtailorPublicJobUrl(url.href);
    provider = "teamtailor";
    slug = parsed.tenant;
    externalId = parsed.externalId;
  } else if (hostname.endsWith(".breezy.hr")) {
    const parsed = parseBreezyPublicJobUrl(url.href);
    provider = "breezy";
    slug = parsed.tenant;
    externalId = parsed.externalId;
  } else {
    const bamboo = hostname.match(BAMBOOHR_HOST_PATTERN);
    if (bamboo && parts.length === 2 && parts[0] === "careers") {
      provider = "bamboohr";
      slug = bamboo[1].toLowerCase();
      try { externalId = decodeURIComponent(parts[1]); }
      catch { throw new Error("BambooHR lead URL contains invalid encoding"); }
    } else {
      const recruitee = hostname.match(RECRUITEE_HOST_PATTERN);
      if (!recruitee || parts.length !== 2 || parts[0] !== "o") {
        throw new Error("Lead resolution is not supported for this application channel yet");
      }
      provider = "recruitee";
      slug = recruitee[1].toLowerCase();
      try { externalId = decodeURIComponent(parts[1]); }
      catch { throw new Error("Recruitee lead URL contains invalid encoding"); }
    }
  }

  const source = CONTROLLED_DISCOVERY_SOURCES.find((candidate) => candidate.provider === provider && candidate.slug === slug);
  if (!source) throw new Error("Lead is not from a controlled discovery source");
  validateEvidence(provider, url.href, source.slug, externalId);

  const jobs = await discover(provider, source.slug, externalId);
  const observed = jobs.find((job) => job.externalId === externalId);
  if (!observed) throw new Error(`Official ${provider} posting is no longer present`);
  validateEvidence(provider, observed.canonicalUrl, source.slug, observed.externalId);
  if (new URL(observed.canonicalUrl).href !== url.href) throw new Error("Official posting URL changed; review the lead before resolving");

  const snapshot = {
    sourceProvider: provider,
    externalId: observed.externalId,
    canonicalUrl: observed.canonicalUrl,
    company: source.company,
    title: observed.title,
    description: observed.description,
    location: observed.location,
    workplaceType: observed.workplaceType,
    score: 0,
    scoreExplanation: ["Unranked: application review uses approved candidate claims"],
    eligibilityRisks: [] as string[],
    postedAt: observed.postedAt,
  };

  return {
    source: {
      id: `catalog-${provider}-${source.slug}`.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 200),
      provider,
      companyName: source.company,
      boardToken: source.slug,
      companyDomain: source.companyDomain,
      careersUrl: source.sourceUrl,
      enabled: true,
    },
    snapshot,
    contentHash: await snapshotHash(snapshot),
  };
}