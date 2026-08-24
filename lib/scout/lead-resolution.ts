import { AshbyAdapter, GreenhouseAdapter, LeverAdapter, WorkablePublicAdapter } from "../adapters.ts";
import {
  validateAshbyEvidenceUrl,
  validateGreenhouseEvidenceUrl,
  validateLeverEvidenceUrl,
  validateWorkableEvidenceUrl,
} from "./contact-extraction.ts";
import { CONTROLLED_DISCOVERY_SOURCES } from "./lead-discovery.ts";
import { snapshotHash } from "./sync.ts";
import type { AtsProvider } from "./types.ts";

export const LEAD_RESOLUTION_CAPABILITIES = Object.freeze({
  controlledSourcesOnly: true,
  greenhouse: true,
  lever: true,
  ashby: true,
  workable: true,
  arbitraryUrlFetch: false,
  submit: false,
  send: false,
} as const);

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
  }
}

async function discover(provider: AtsProvider, token: string) {
  switch (provider) {
    case "greenhouse": return new GreenhouseAdapter().discover(token);
    case "lever": return new LeverAdapter().discover(token);
    case "ashby": return new AshbyAdapter().discover(token);
    case "workable": return new WorkablePublicAdapter().discover(token);
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
  } else {
    throw new Error("Lead resolution is not supported for this application channel yet");
  }

  const source = CONTROLLED_DISCOVERY_SOURCES.find((candidate) => candidate.provider === provider && candidate.slug === slug);
  if (!source) throw new Error("Lead is not from a controlled discovery source");
  validateEvidence(provider, url.href, source.slug, externalId);

  const jobs = await discover(provider, source.slug);
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
      id: `catalog-${provider}-${source.slug}`,
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
