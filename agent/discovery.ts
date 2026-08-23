import { discoverControlledInternships } from "../lib/scout/lead-discovery.ts";

export const AGENT_DISCOVERY_CAPABILITIES = Object.freeze({
  controlledCatalogOnly: true,
  callerSuppliedSources: false,
  arbitraryUrlFetch: false,
  linkedinScrape: false,
  privateContactScrape: false,
  sendEmail: false,
  submitApplication: false,
} as const);

type DiscoveryResult = Awaited<ReturnType<typeof discoverControlledInternships>>;

export async function runAgentDiscovery(
  discover: () => Promise<DiscoveryResult> = discoverControlledInternships,
  now: () => string = () => new Date().toISOString(),
) {
  const result = await discover();
  return {
    schemaVersion: 1 as const,
    observedAt: now(),
    found: result.leads.length,
    failures: result.failures,
    leads: result.leads.map((lead) => ({
      provider: lead.provider,
      canonicalUrl: lead.canonicalUrl,
      company: lead.company,
      title: lead.title,
      sourceUrl: lead.sourceUrl,
      focus: lead.focus,
      location: lead.location,
      postedAt: lead.postedAt ?? null,
      platformId: lead.channel.id,
      nextStep: lead.nextStep,
    })),
  };
}
