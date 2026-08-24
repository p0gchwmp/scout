import { AshbyAdapter, GreenhouseAdapter, LeverAdapter, WorkablePublicAdapter } from "../adapters.ts";
import type { NormalizedJob } from "../types.ts";
import { normalizeInternshipLead } from "./job-intake.ts";
import type { AtsProvider } from "./types.ts";

export const LEAD_DISCOVERY_CAPABILITIES = Object.freeze({
  controlledSourcesOnly: true,
  publicAtsFetch: true,
  arbitraryUrlFetch: false,
  linkedinScrape: false,
  contactScrape: false,
  submit: false,
  send: false,
} as const);

type DiscoverySource = {
  provider: AtsProvider;
  slug: string;
  company: string;
  sourceUrl: string;
  focus: string;
  companyDomain: string;
};

import discoveryCatalog from "../../config/discovery-sources.json" with { type: "json" };

// Public ATS boards only. Client callers cannot add slugs or URLs to this list.
export const CONTROLLED_DISCOVERY_SOURCES: readonly DiscoverySource[] = Object.freeze(
  discoveryCatalog.map((source) => ({ ...source })) as DiscoverySource[],
);

export type DiscoveredInternshipLead = ReturnType<typeof normalizeInternshipLead> & {
  provider: DiscoverySource["provider"];
  sourceUrl: string;
  focus: string;
  location: string;
  description: string;
  postedAt?: string;
};

const INTERNSHIP_PATTERN = /\b(intern|internship|trainee|apprentice|co-?op)\b/i;
const INDIA_OR_REMOTE_PATTERN = /\b(india|bengaluru|bangalore|chennai|hyderabad|noida|gurugram|gurgaon|mumbai|delhi|pune|kolkata|remote)\b/i;

function isRelevantInternship(job: NormalizedJob) {
  const roleText = `${job.title}\n${job.description}`;
  if (!INTERNSHIP_PATTERN.test(roleText)) return false;
  const locationText = `${job.location}\n${job.workplaceType}\n${job.description.slice(0, 1200)}`;
  return INDIA_OR_REMOTE_PATTERN.test(locationText);
}

async function discoverSource(source: DiscoverySource): Promise<NormalizedJob[]> {
  switch (source.provider) {
    case "greenhouse": return new GreenhouseAdapter().discover(source.slug);
    case "lever": return new LeverAdapter().discover(source.slug);
    case "ashby": return new AshbyAdapter().discover(source.slug);
    case "workable": return new WorkablePublicAdapter().discover(source.slug);
  }
}

export async function discoverControlledInternships() {
  const settled = await Promise.allSettled(CONTROLLED_DISCOVERY_SOURCES.map(async (source) => {
    const jobs = await discoverSource(source);
    return jobs.filter(isRelevantInternship).map((job) => ({ source, job }));
  }));

  const leads: DiscoveredInternshipLead[] = [];
  const failures: Array<{ company: string; provider: string; reason: string }> = [];

  settled.forEach((result, index) => {
    const source = CONTROLLED_DISCOVERY_SOURCES[index];
    if (result.status === "rejected") {
      failures.push({ company: source.company, provider: source.provider, reason: "Public ATS source was temporarily unavailable" });
      return;
    }
    for (const { job } of result.value) {
      try {
        const normalized = normalizeInternshipLead({
          url: job.canonicalUrl,
          company: source.company,
          title: job.title,
        });
        leads.push({
          ...normalized,
          provider: source.provider,
          sourceUrl: source.sourceUrl,
          focus: source.focus,
          location: job.location,
          description: job.description,
          postedAt: job.postedAt,
        });
      } catch {
        // An ATS result with a malformed/non-HTTPS canonical URL is ignored.
      }
    }
  });

  const deduped = [...new Map(leads.map((lead) => [lead.canonicalUrl, lead])).values()];
  deduped.sort((left, right) => {
    const rightDate = Date.parse(right.postedAt ?? "") || 0;
    const leftDate = Date.parse(left.postedAt ?? "") || 0;
    return rightDate - leftDate || left.company.localeCompare(right.company);
  });

  return { leads: deduped.slice(0, 60), failures };
}
