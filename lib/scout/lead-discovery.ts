import { GreenhouseAdapter, LeverAdapter } from "../adapters.ts";
import type { NormalizedJob } from "../types.ts";
import { normalizeInternshipLead } from "./job-intake.ts";

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
  provider: "greenhouse" | "lever";
  slug: string;
  company: string;
  sourceUrl: string;
  focus: string;
  companyDomain: string;
};

// Public ATS boards only. Client callers cannot add slugs or URLs to this list.
// These are intentionally broad across product/startups/operations/health-tech;
// Scout filters the returned postings to internship/early-career leads in
// India or explicitly remote locations.
export const CONTROLLED_DISCOVERY_SOURCES: readonly DiscoverySource[] = Object.freeze([
  { provider: "greenhouse", slug: "fourkites", company: "FourKites", sourceUrl: "https://job-boards.greenhouse.io/fourkites", focus: "product, operations, documentation", companyDomain: "fourkites.com" },
  { provider: "greenhouse", slug: "enterpret", company: "Enterpret", sourceUrl: "https://job-boards.greenhouse.io/enterpret", focus: "product, startups, customer intelligence", companyDomain: "enterpret.com" },
  { provider: "greenhouse", slug: "project44", company: "project44", sourceUrl: "https://job-boards.greenhouse.io/project44", focus: "product, logistics, operations", companyDomain: "project44.com" },
  { provider: "greenhouse", slug: "impiricus", company: "Impiricus", sourceUrl: "https://job-boards.greenhouse.io/impiricus", focus: "health-tech, product, operations, finance", companyDomain: "impiricus.com" },
  { provider: "lever", slug: "paytm", company: "Paytm", sourceUrl: "https://jobs.lever.co/paytm", focus: "product, fintech, operations", companyDomain: "paytm.com" },
  { provider: "lever", slug: "Sprinto", company: "Sprinto", sourceUrl: "https://jobs.lever.co/Sprinto", focus: "product-led growth, operations, startups", companyDomain: "sprinto.com" },
  { provider: "lever", slug: "weekdayworks", company: "Weekday", sourceUrl: "https://jobs.lever.co/weekdayworks", focus: "operations, startups", companyDomain: "weekday.works" },
  { provider: "lever", slug: "dozee", company: "Dozee", sourceUrl: "https://jobs.lever.co/dozee", focus: "health-tech, operations", companyDomain: "dozeehealth.ai" },
  { provider: "lever", slug: "100ms", company: "100ms", sourceUrl: "https://jobs.lever.co/100ms", focus: "health-tech AI, product, people", companyDomain: "100ms.live" },
]);

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
  return source.provider === "greenhouse"
    ? new GreenhouseAdapter().discover(source.slug)
    : new LeverAdapter().discover(source.slug);
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
