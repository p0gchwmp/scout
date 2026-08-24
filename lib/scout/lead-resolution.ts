import { GreenhouseAdapter, LeverAdapter } from "../adapters.ts";
import { validateGreenhouseEvidenceUrl } from "./contact-extraction.ts";
import { CONTROLLED_DISCOVERY_SOURCES } from "./lead-discovery.ts";
import { snapshotHash } from "./sync.ts";

export const LEAD_RESOLUTION_CAPABILITIES = Object.freeze({
  controlledSourcesOnly: true,
  greenhouse: true,
  lever: true,
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

export async function resolveControlledLead(canonicalUrl: string) {
  const url = exactHttpsUrl(canonicalUrl);
  const hostname = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  let provider: "greenhouse" | "lever";
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
  } else {
    throw new Error("Lead resolution is not supported for this application channel yet");
  }

  const source = CONTROLLED_DISCOVERY_SOURCES.find((candidate) => candidate.provider === provider && candidate.slug === slug);
  if (!source) throw new Error("Lead is not from a controlled discovery source");
  if (provider === "greenhouse") validateGreenhouseEvidenceUrl(url.href, source.slug, externalId);

  const jobs = provider === "greenhouse"
    ? await new GreenhouseAdapter().discover(source.slug)
    : await new LeverAdapter().discover(source.slug);
  const observed = jobs.find((job) => job.externalId === externalId);
  if (!observed) throw new Error(`Official ${provider === "greenhouse" ? "Greenhouse" : "Lever"} posting is no longer present`);
  if (provider === "greenhouse") validateGreenhouseEvidenceUrl(observed.canonicalUrl, source.slug, observed.externalId);
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
