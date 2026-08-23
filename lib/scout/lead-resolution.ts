import { GreenhouseAdapter } from "../adapters.ts";
import { validateGreenhouseEvidenceUrl } from "./contact-extraction.ts";
import { CONTROLLED_DISCOVERY_SOURCES } from "./lead-discovery.ts";
import { snapshotHash } from "./sync.ts";

export const LEAD_RESOLUTION_CAPABILITIES = Object.freeze({
  controlledSourcesOnly: true,
  greenhouse: true,
  lever: false,
  arbitraryUrlFetch: false,
  submit: false,
  send: false,
} as const);

export async function resolveControlledLead(canonicalUrl: string) {
  let url: URL;
  try { url = new URL(canonicalUrl); }
  catch { throw new Error("Lead URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Lead URL is not an exact supported HTTPS posting URL");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (!(["job-boards.greenhouse.io", "boards.greenhouse.io"].includes(url.hostname.toLowerCase())) || parts.length !== 3 || parts[1] !== "jobs") {
    throw new Error("Lead resolution is not supported for this application channel yet");
  }

  const source = CONTROLLED_DISCOVERY_SOURCES.find((candidate) => candidate.provider === "greenhouse" && candidate.slug === parts[0]);
  if (!source) throw new Error("Lead is not from a controlled discovery source");
  validateGreenhouseEvidenceUrl(url.href, source.slug, parts[2]);

  const jobs = await new GreenhouseAdapter().discover(source.slug);
  const observed = jobs.find((job) => job.externalId === parts[2]);
  if (!observed) throw new Error("Official Greenhouse posting is no longer present");
  validateGreenhouseEvidenceUrl(observed.canonicalUrl, source.slug, observed.externalId);
  if (new URL(observed.canonicalUrl).href !== url.href) throw new Error("Official posting URL changed; review the lead before resolving");

  const snapshot = {
    sourceProvider: "greenhouse" as const,
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
      id: `catalog-greenhouse-${source.slug}`,
      provider: "greenhouse" as const,
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
