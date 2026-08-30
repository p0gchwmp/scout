export const ECOSYSTEM_DISCOVERY_CAPABILITIES = Object.freeze({
  officialSourcesOnly: true,
  curatedRegistryIsBootstrapNotAllowlist: true,
  unregisteredLeadsRequireReview: true,
  portfolioBoardsLeadOnly: true,
  publicBusinessContactsOnly: true,
  exactContactProvenanceRequired: true,
  newContactsNeedReview: true,
  linkedinLeadOnly: true,
  guessEmails: false,
  scrapePersonalContacts: false,
  bypassCaptcha: false,
  sendEmail: false,
  submitApplication: false,
} as const);

export type EcosystemInstitutionType =
  | "venture_capital"
  | "accelerator"
  | "incubator"
  | "venture_studio"
  | "angel_network"
  | "family_office"
  | "growth_equity"
  | "private_equity"
  | "impact_investor"
  | "corporate_venture_capital"
  | "innovation_platform"
  | "search_fund"
  | "university_venture"
  | "development_finance"
  | "think_tank"
  | "startup_network";

export type EcosystemLane =
  | "capital_firms"
  | "portfolio_talent"
  | "accelerators_incubators"
  | "venture_studios"
  | "angels_family_offices"
  | "impact_health_climate"
  | "cvc_innovation"
  | "growth_private_equity"
  | "fellowships_scouts"
  | "founders_office_startup_ops"
  | "university_entrepreneurship"
  | "policy_development_finance"
  | "startup_networks";

export type EcosystemOpportunityType =
  | "fund_role"
  | "internship"
  | "investment_analyst"
  | "research_analyst"
  | "platform_portfolio_ops"
  | "investor_relations"
  | "fund_operations"
  | "venture_fellow"
  | "venture_scout"
  | "portfolio_job"
  | "founders_office"
  | "strategy_operations"
  | "program_associate"
  | "talent_network"
  | "general_interest"
  | "ecosystem_program";

export type EcosystemSource = {
  id: string;
  name: string;
  institutionType: EcosystemInstitutionType;
  companyDomain: string;
  officialUrl: string;
  directCareersUrl: string | null;
  portfolioBoardUrl: string | null;
  portfolioBoardHost: string | null;
  directRecruitingTarget: boolean;
  notes: string;
};

// Bootstrap registry only. Search discovery is deliberately broader than this list.
// Registered sources get stronger routing; unregistered ecosystem results remain review-only
// until their official institution/employer provenance is verified.
export const ECOSYSTEM_SOURCES: readonly EcosystemSource[] = Object.freeze([
  {
    id: "blume",
    name: "Blume Ventures",
    institutionType: "venture_capital",
    companyDomain: "blume.vc",
    officialUrl: "https://blume.vc/",
    directCareersUrl: "https://blume.vc/work-with-us",
    portfolioBoardUrl: "https://jobs.blume.vc/jobs",
    portfolioBoardHost: "jobs.blume.vc",
    directRecruitingTarget: true,
    notes: "Official Work With Us page supports current openings and career interest; portfolio board remains lead-only for portfolio-company roles.",
  },
  {
    id: "chiratae",
    name: "Chiratae Ventures",
    institutionType: "venture_capital",
    companyDomain: "chiratae.com",
    officialUrl: "https://www.chiratae.com/",
    directCareersUrl: "https://www.chiratae.com/careers/",
    portfolioBoardUrl: "https://careers.chiratae.com/jobs",
    portfolioBoardHost: "careers.chiratae.com",
    directRecruitingTarget: true,
    notes: "Official careers page routes institution openings; portfolio board remains lead-only for portfolio-company roles.",
  },
  {
    id: "peak_xv",
    name: "Peak XV Partners",
    institutionType: "venture_capital",
    companyDomain: "peakxv.com",
    officialUrl: "https://www.peakxv.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://careers.peakxv.com/jobs",
    portfolioBoardHost: "careers.peakxv.com",
    directRecruitingTarget: false,
    notes: "Portfolio jobs and talent network are useful lead surfaces; Scout must not automate reCAPTCHA-protected talent-network signup.",
  },
  {
    id: "surge",
    name: "Surge by Peak XV",
    institutionType: "accelerator",
    companyDomain: "peakxv.com",
    officialUrl: "https://www.peakxv.com/surge/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://careers.surge.peakxv.com/jobs",
    portfolioBoardHost: "careers.surge.peakxv.com",
    directRecruitingTarget: false,
    notes: "Accelerator portfolio/talent surface; founder-program application is not treated as a student job application.",
  },
  {
    id: "nexus",
    name: "Nexus Venture Partners",
    institutionType: "venture_capital",
    companyDomain: "nexusvp.com",
    officialUrl: "https://nexusvp.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.nexusvp.com/jobs",
    portfolioBoardHost: "jobs.nexusvp.com",
    directRecruitingTarget: false,
    notes: "Official portfolio job board is a lead surface; resolve each portfolio employer before application preparation.",
  },
  {
    id: "accel",
    name: "Accel",
    institutionType: "venture_capital",
    companyDomain: "accel.com",
    officialUrl: "https://www.accel.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.accel.com/jobs",
    portfolioBoardHost: "jobs.accel.com",
    directRecruitingTarget: false,
    notes: "Official portfolio job board is a discovery lead surface, not employer proof.",
  },
  {
    id: "a16z",
    name: "Andreessen Horowitz (a16z)",
    institutionType: "venture_capital",
    companyDomain: "a16z.com",
    officialUrl: "https://a16z.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.a16z.com/jobs",
    portfolioBoardHost: "jobs.a16z.com",
    directRecruitingTarget: false,
    notes: "Portfolio and college-talent surfaces are high-value leads. Direct a16z roles still require exact official role evidence before Safe Fill.",
  },
  {
    id: "general_catalyst",
    name: "General Catalyst",
    institutionType: "venture_capital",
    companyDomain: "generalcatalyst.com",
    officialUrl: "https://www.generalcatalyst.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.generalcatalyst.com/jobs",
    portfolioBoardHost: "jobs.generalcatalyst.com",
    directRecruitingTarget: false,
    notes: "Official portfolio board; every portfolio-company role must resolve to employer evidence before application preparation.",
  },
  {
    id: "lightspeed",
    name: "Lightspeed Venture Partners",
    institutionType: "venture_capital",
    companyDomain: "lsvp.com",
    officialUrl: "https://lsvp.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.lsvp.com/jobs",
    portfolioBoardHost: "jobs.lsvp.com",
    directRecruitingTarget: false,
    notes: "Official portfolio careers surface with internship filtering; use as lead/context, not employer proof.",
  },
  {
    id: "khosla",
    name: "Khosla Ventures",
    institutionType: "venture_capital",
    companyDomain: "khoslaventures.com",
    officialUrl: "https://www.khoslaventures.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.khoslaventures.com/jobs",
    portfolioBoardHost: "jobs.khoslaventures.com",
    directRecruitingTarget: false,
    notes: "Official portfolio job and talent-network surface; public general or media inboxes are not recruiting contacts unless the evidence says so.",
  },
  {
    id: "eightvc",
    name: "8VC",
    institutionType: "venture_capital",
    companyDomain: "8vc.com",
    officialUrl: "https://www.8vc.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.8vc.com/jobs",
    portfolioBoardHost: "jobs.8vc.com",
    directRecruitingTarget: false,
    notes: "Official portfolio board and talent-network surface; keep portfolio contacts separate from fund recruiting evidence.",
  },
  {
    id: "bain_capital_ventures",
    name: "Bain Capital Ventures",
    institutionType: "venture_capital",
    companyDomain: "baincapitalventures.com",
    officialUrl: "https://www.baincapitalventures.com/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.baincapitalventures.com/jobs",
    portfolioBoardHost: "jobs.baincapitalventures.com",
    directRecruitingTarget: false,
    notes: "Official portfolio board supports internship and remote filters; portfolio roles remain lead-only until employer resolution.",
  },
  {
    id: "five_hundred_global",
    name: "500 Global",
    institutionType: "accelerator",
    companyDomain: "500.co",
    officialUrl: "https://500.co/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://jobs.500.co/jobs",
    portfolioBoardHost: "jobs.500.co",
    directRecruitingTarget: false,
    notes: "Global accelerator/investor portfolio board; use for startup-job discovery, then resolve the employer's official role.",
  },
  {
    id: "techstars",
    name: "Techstars",
    institutionType: "accelerator",
    companyDomain: "techstars.com",
    officialUrl: "https://www.techstars.com/",
    directCareersUrl: "https://www.techstars.com/careers",
    portfolioBoardUrl: "https://jobs.techstars.com/jobs",
    portfolioBoardHost: "jobs.techstars.com",
    directRecruitingTarget: true,
    notes: "Official careers page includes Techstars roles and associate/internship pathways; network board is lead-only for portfolio-company roles.",
  },
  {
    id: "antler",
    name: "Antler",
    institutionType: "accelerator",
    companyDomain: "antler.co",
    officialUrl: "https://www.antler.co/",
    directCareersUrl: null,
    portfolioBoardUrl: "https://careers.antler.co/jobs",
    portfolioBoardHost: "careers.antler.co",
    directRecruitingTarget: false,
    notes: "Official network job board; founder residencies and founder applications are not treated as ordinary student employment applications.",
  },
] as const);

export const ECOSYSTEM_ADJACENT_LANES = Object.freeze([
  "venture_capital",
  "vc_portfolio_talent_networks",
  "accelerators_incubators",
  "venture_studios_startup_studios",
  "angel_networks_syndicates",
  "family_offices",
  "impact_investing_esg_climate",
  "corporate_venture_capital_innovation",
  "growth_equity_private_equity_early_career",
  "search_funds_eta",
  "venture_fellowships_scout_programs",
  "portfolio_founders_office_strategy_ops",
  "startup_operator_networks",
  "university_incubators_venture_funds",
  "health_innovation_accelerators",
  "think_tanks_economic_research",
  "development_finance_multilateral",
] as const);

export type EcosystemSearchQuery = {
  id: string;
  lane: EcosystemLane;
  institutionType: EcosystemInstitutionType;
  focus: string;
  query: string;
};

export const ECOSYSTEM_SEARCH_QUERIES: readonly EcosystemSearchQuery[] = Object.freeze([
  {
    id: "capital_direct_india",
    lane: "capital_firms",
    institutionType: "venture_capital",
    focus: "India venture, seed, growth and investment-firm early-career roles",
    query: 'India internship "investment analyst" OR "research analyst" OR "platform" OR "portfolio operations" OR "fund operations" venture capital seed fund growth fund careers',
  },
  {
    id: "capital_direct_global_remote",
    lane: "capital_firms",
    institutionType: "venture_capital",
    focus: "Global or remote capital-firm internships, analyst roles and student programs",
    query: 'remote internship venture capital investment analyst research analyst portfolio platform operations fellowship student careers "work with us"',
  },
  {
    id: "registered_portfolio_boards",
    lane: "portfolio_talent",
    institutionType: "startup_network",
    focus: "Registered investor and accelerator portfolio boards with internships, remote roles and early-career startup opportunities",
    query: "internship India remote product operations strategy finance research analyst founder's office site:jobs.blume.vc OR site:careers.peakxv.com OR site:careers.chiratae.com OR site:jobs.nexusvp.com OR site:jobs.accel.com OR site:jobs.a16z.com OR site:jobs.generalcatalyst.com OR site:jobs.lsvp.com OR site:jobs.khoslaventures.com OR site:jobs.8vc.com OR site:jobs.baincapitalventures.com OR site:jobs.500.co OR site:jobs.techstars.com OR site:careers.antler.co",
  },
  {
    id: "accelerators_incubators",
    lane: "accelerators_incubators",
    institutionType: "accelerator",
    focus: "Accelerator and incubator staff, associate, program, venture and portfolio opportunities",
    query: 'internship associate analyst program operations portfolio talent accelerator incubator startup ecosystem India remote careers Techstars Antler 500 Global Entrepreneur First university incubator',
  },
  {
    id: "venture_studios",
    lane: "venture_studios",
    institutionType: "venture_studio",
    focus: "Venture studio, startup studio and company-building internships or analyst/operator roles",
    query: 'internship analyst associate operations strategy product "venture studio" OR "startup studio" OR "company builder" India remote careers',
  },
  {
    id: "angels_family_offices",
    lane: "angels_family_offices",
    institutionType: "family_office",
    focus: "Angel-network, syndicate and family-office research, investment and operations roles",
    query: 'internship analyst research investment operations "angel network" OR syndicate OR "family office" India careers',
  },
  {
    id: "impact_health_climate",
    lane: "impact_health_climate",
    institutionType: "impact_investor",
    focus: "Impact, climate, health, development and social-investment early-career roles",
    query: 'internship analyst research impact investing climate healthtech social impact development fund India remote careers',
  },
  {
    id: "cvc_innovation",
    lane: "cvc_innovation",
    institutionType: "corporate_venture_capital",
    focus: "Corporate venture, strategic investment, innovation-lab and startup-partnership roles",
    query: 'internship analyst "corporate venture" "strategic investments" innovation startup partnerships venture client India remote careers',
  },
  {
    id: "growth_private_equity",
    lane: "growth_private_equity",
    institutionType: "growth_equity",
    focus: "Growth-equity and selected private-equity internships or analyst roles compatible with early-career candidates",
    query: 'internship analyst research "growth equity" OR "private equity" India student early career careers',
  },
  {
    id: "fellowships_scouts",
    lane: "fellowships_scouts",
    institutionType: "startup_network",
    focus: "Venture fellowships, scout programs, student investor networks and startup talent programs",
    query: 'student "venture fellow" OR "venture fellowship" OR "venture scout" OR "student scout" startup talent program India remote application',
  },
  {
    id: "founders_office_startup_ops",
    lane: "founders_office_startup_ops",
    institutionType: "startup_network",
    focus: "Founder’s Office, strategy, business operations and generalist internships across funded startups",
    query: 'internship "founder\'s office" OR "founders office" OR strategy OR "business operations" startup India remote intern analyst',
  },
  {
    id: "university_entrepreneurship",
    lane: "university_entrepreneurship",
    institutionType: "university_venture",
    focus: "University incubators, entrepreneurship centres, student venture funds and innovation programs",
    query: 'internship fellowship student "venture fund" incubator entrepreneurship centre innovation lab university India startup',
  },
  {
    id: "policy_development_finance",
    lane: "policy_development_finance",
    institutionType: "development_finance",
    focus: "Development-finance, economic-research, policy and innovation institutions with internship or analyst pathways",
    query: 'internship analyst research economics policy "development finance" innovation fund India student careers',
  },
  {
    id: "startup_networks",
    lane: "startup_networks",
    institutionType: "startup_network",
    focus: "Broader reputable startup talent networks and ecosystem job boards that can lead to official employer roles",
    query: 'startup internship India remote product operations strategy finance research analyst portfolio jobs startup network talent network',
  },
] as const);

type SearchResult = { title: string; url: string; description?: string };

export type EcosystemLead = {
  sourceId: string | null;
  sourceName: string;
  institutionType: EcosystemInstitutionType;
  lane: EcosystemLane | null;
  sourceMode: "direct_institution" | "portfolio_board" | "ecosystem_index_lead";
  title: string;
  url: string;
  description: string;
  requiresOfficialSourceRegistration: boolean;
  requiresOfficialEmployerResolution: boolean;
  applicationPath:
    | "snapshot_official_role_then_safe_fill"
    | "resolve_portfolio_employer_then_safe_fill"
    | "review_register_source_then_resolve_official_role";
  contactPath:
    | "official_public_recruiting_contact_review"
    | "not_from_portfolio_board"
    | "blocked_until_source_review";
};

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeHost(value: string) {
  return value.toLowerCase().replace(/^www\./, "");
}

function domainLabel(hostname: string) {
  return normalizeHost(hostname)
    .split(".")
    .filter((part) => !["www", "jobs", "careers", "work", "apply"].includes(part))[0]
    ?.replace(/[-_]+/g, " ") || normalizeHost(hostname);
}

const NON_OFFICIAL_LEAD_HOSTS = Object.freeze([
  "linkedin.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "medium.com",
  "substack.com",
  "crunchbase.com",
  "pitchbook.com",
  "tracxn.com",
  "signalhire.com",
  "rocketreach.co",
  "apollo.io",
  "hunter.io",
]);

function blockedUnregisteredHost(host: string) {
  return NON_OFFICIAL_LEAD_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
}

function sourceForUrl(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = normalizeHost(url.hostname);
  for (const source of ECOSYSTEM_SOURCES) {
    if (source.portfolioBoardHost && host === normalizeHost(source.portfolioBoardHost)) {
      return { source, mode: "portfolio_board" as const };
    }
    if (host === normalizeHost(source.companyDomain) || host.endsWith(`.${normalizeHost(source.companyDomain)}`)) {
      return { source, mode: "direct_institution" as const };
    }
  }
  return null;
}

export function normalizeEcosystemSearchResult(result: SearchResult, query?: EcosystemSearchQuery): EcosystemLead | null {
  let url: URL;
  try { url = new URL(result.url); }
  catch { return null; }
  if (url.protocol !== "https:") return null;

  const matched = sourceForUrl(result.url);
  const title = clean(result.title).slice(0, 300) || "Ecosystem opportunity";
  const description = clean(result.description).slice(0, 1200);

  if (matched?.mode === "portfolio_board") {
    return {
      sourceId: matched.source.id,
      sourceName: matched.source.name,
      institutionType: matched.source.institutionType,
      lane: query?.lane ?? "portfolio_talent",
      sourceMode: "portfolio_board",
      title,
      url: result.url,
      description,
      requiresOfficialSourceRegistration: false,
      requiresOfficialEmployerResolution: true,
      applicationPath: "resolve_portfolio_employer_then_safe_fill",
      contactPath: "not_from_portfolio_board",
    };
  }

  if (matched?.mode === "direct_institution") {
    const careerish = /career|work with us|job|opening|intern|analyst|associate|fellow|talent|opportunit|program|research|investment|platform|operations/i.test(`${title} ${description} ${result.url}`);
    if (!careerish) return null;
    return {
      sourceId: matched.source.id,
      sourceName: matched.source.name,
      institutionType: matched.source.institutionType,
      lane: query?.lane ?? "capital_firms",
      sourceMode: "direct_institution",
      title,
      url: result.url,
      description,
      requiresOfficialSourceRegistration: false,
      requiresOfficialEmployerResolution: false,
      applicationPath: "snapshot_official_role_then_safe_fill",
      contactPath: "official_public_recruiting_contact_review",
    };
  }

  // Broad discovery is intentionally not constrained to the bootstrap registry.
  // An unregistered result may surface as a lead, but it cannot become trusted job/contact
  // evidence until a human reviews the source and Scout resolves the official institution/employer.
  const host = normalizeHost(url.hostname);
  if (!query || blockedUnregisteredHost(host)) return null;
  const opportunityish = /career|job|intern|analyst|associate|fellow|scout|talent|opportunit|program|research|investment|portfolio|operations|strategy|founder/i.test(`${title} ${description} ${url.pathname}`);
  if (!opportunityish) return null;
  return {
    sourceId: null,
    sourceName: domainLabel(host),
    institutionType: query.institutionType,
    lane: query.lane,
    sourceMode: "ecosystem_index_lead",
    title,
    url: result.url,
    description,
    requiresOfficialSourceRegistration: true,
    requiresOfficialEmployerResolution: true,
    applicationPath: "review_register_source_then_resolve_official_role",
    contactPath: "blocked_until_source_review",
  };
}

export function buildEcosystemOutreachSeeds(existingDomains: readonly string[] = []) {
  const existing = new Set(existingDomains.map((domain) => normalizeHost(domain)));
  return ECOSYSTEM_SOURCES
    .filter((source) => source.directRecruitingTarget && source.directCareersUrl && !existing.has(normalizeHost(source.companyDomain)))
    .map((source, index) => ({
      sourceId: source.id,
      companyName: source.name,
      companyDomain: normalizeHost(source.companyDomain),
      officialUrl: source.directCareersUrl!,
      track: "summer_2027" as const,
      researchFocus: `[ecosystem:${source.institutionType}] early-career recruiting, internships, analyst/research, platform/portfolio operations, program roles and student-compatible opportunities`,
      priorityScore: Math.max(50, 78 - index * 3),
      origin: "watchlist" as const,
    }));
}

export function assessEcosystemRecruitingContact(input: { email: string; sourceUrl: string; excerpt: string }) {
  const text = `${clean(input.email)} ${clean(input.sourceUrl)} ${clean(input.excerpt)}`.toLowerCase();
  const recruiting = /career|recruit|talent|hiring|job|work with us|resume|people team|human resources|college talent|university recruiting|\bhr\b/.test(text);
  const wrongPurpose = /pitch|startup submission|deal flow|media|press|public relations|investor relations|\blp\b|fundraising|founder application|demo day application/.test(text);
  if (wrongPurpose && !recruiting) {
    return { allowed: false, suitability: "reject" as const, reason: "Published address appears intended for pitching, media, LP/investor, fundraising or founder-program traffic rather than recruiting." };
  }
  if (recruiting) {
    return { allowed: true, suitability: "high" as const, reason: "Official public evidence explicitly indicates recruiting/careers/talent relevance; human acceptance is still required." };
  }
  return { allowed: true, suitability: "review" as const, reason: "Official public business address has no explicit recruiting-purpose signal; keep needs_review and do not treat it as recruiter-ready automatically." };
}
