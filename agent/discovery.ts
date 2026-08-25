import { discoverControlledInternships } from "../lib/scout/lead-discovery.ts";
import { consolidateOpportunityLeads } from "../lib/scout/opportunity-quality.ts";
import type { AtsProvider } from "../lib/scout/types.ts";
import { discoverSearchIndexInternships } from "./search-discovery.ts";

export const AGENT_DISCOVERY_CAPABILITIES = Object.freeze({
  controlledCatalog: true,
  optionalSearchIndex: true,
  fixedSearchQueriesOnly: true,
  opportunityDedupe: true,
  preferOfficialAts: true,
  suppressClearlySeniorSearchNoise: true,
  callerSuppliedSources: false,
  arbitraryUrlFetch: false,
  linkedinScrape: false,
  privateContactScrape: false,
  sendEmail: false,
  submitApplication: false,
} as const);

type DiscoveryResult = Awaited<ReturnType<typeof discoverControlledInternships>>;
type SearchResult = Awaited<ReturnType<typeof discoverSearchIndexInternships>>;

export async function runAgentDiscovery(
  discover: () => Promise<DiscoveryResult> = discoverControlledInternships,
  now: () => string = () => new Date().toISOString(),
  searchDiscover: () => Promise<SearchResult> = discoverSearchIndexInternships,
) {
  const [controlled, search] = await Promise.all([
    discover(),
    searchDiscover().catch(() => ({ enabled: true, leads: [], failures: [{ company: "Search index", provider: "search", reason: "Optional search discovery failed" }] })),
  ]);

  const controlledLeads = controlled.leads.map((lead) => ({
    provider: lead.provider as AtsProvider | "search_index",
    canonicalUrl: lead.canonicalUrl,
    company: lead.company,
    title: lead.title,
    sourceUrl: lead.sourceUrl,
    focus: lead.focus,
    location: lead.location,
    postedAt: lead.postedAt ?? null,
    platformId: lead.channel.id,
    nextStep: lead.nextStep,
  }));
  const observedAt = now();
  const quality = consolidateOpportunityLeads([...controlledLeads, ...search.leads], new Date(observedAt));
  const leads = quality.leads.map((lead) => ({
    ...lead,
    focus: `${lead.focus} · ${lead.qualityTier} quality · ${lead.authorityLabel}${lead.duplicateCount ? ` · ${lead.duplicateCount} duplicate lead${lead.duplicateCount === 1 ? "" : "s"} consolidated` : ""}`.slice(0, 500),
    nextStep: `${lead.nextStep}${lead.provenanceUrls.length > 1 ? ` Discovery provenance observed across ${lead.provenanceUrls.length} public URL(s); the most authoritative lead was retained.` : ""}`.slice(0, 1000),
  }));

  return {
    schemaVersion: 1 as const,
    observedAt,
    found: leads.length,
    failures: [...controlled.failures, ...search.failures],
    leads,
    qualitySummary: quality.summary,
    discoveryModes: {
      controlledAts: true,
      searchIndex: search.enabled,
    },
  };
}
