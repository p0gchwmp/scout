export const ROLE_TAXONOMY_CAPABILITIES = Object.freeze({
  broadFunctionalCoverage: true,
  separatesFunctionFromSector: true,
  softwareDevelopmentVisible: true,
  softwareDevelopmentHardExcluded: false,
  geographyBias: false,
} as const);

export type RoleFamilyId =
  | "product"
  | "analytics"
  | "business_strategy"
  | "finance_economics"
  | "operations"
  | "research"
  | "technical_systems"
  | "software_development"
  | "generalist";

export type RolePreferenceLane = "broad_fit" | "software_stretch";

export type RoleSectorTag = "Health-tech" | "Policy / governance" | "Fintech";

export type RoleFamilyDefinition = {
  id: RoleFamilyId;
  label: string;
  shortLabel: string;
  description: string;
};

export const ROLE_FAMILIES: readonly RoleFamilyDefinition[] = Object.freeze([
  { id: "product", label: "Product", shortLabel: "Product", description: "Product analysis, product operations, APM-style and product strategy work." },
  { id: "analytics", label: "Analytics", shortLabel: "Analytics", description: "Business, data, product, growth, revenue and operations analysis." },
  { id: "business_strategy", label: "Business & strategy", shortLabel: "Business", description: "Strategy, growth, GTM, partnerships, market research and founder's-office-style work." },
  { id: "finance_economics", label: "Finance & economics", shortLabel: "Finance", description: "Financial analysis, FP&A, markets, investment research, pricing and economics work." },
  { id: "operations", label: "Operations", shortLabel: "Operations", description: "Business operations, program/project operations, process, logistics and execution roles." },
  { id: "research", label: "Research", shortLabel: "Research", description: "Research assistant, industry research, market intelligence and evidence-synthesis roles." },
  { id: "technical_systems", label: "Technical systems", shortLabel: "Tech-adjacent", description: "Implementation, solutions, QA, automation, systems, integrations and technical operations." },
  { id: "software_development", label: "Software development", shortLabel: "Software dev", description: "Primarily software-engineering or development work. Visible to Scout, but a stretch preference by default." },
  { id: "generalist", label: "Generalist / other", shortLabel: "Generalist", description: "Early-career roles that do not map cleanly to one functional family." },
]);

const FAMILY_BY_ID = new Map(ROLE_FAMILIES.map((family) => [family.id, family]));

type FamilyRule = {
  id: Exclude<RoleFamilyId, "generalist">;
  title: RegExp;
  text: RegExp;
};

const FAMILY_RULES: readonly FamilyRule[] = [
  {
    id: "technical_systems",
    title: /\b(?:implementation|solutions?|systems?|integration|automation|quality assurance|qa|technical operations?|technical program|technical project|support engineer|solutions engineer|implementation consultant|implementation specialist|ai operations?|ml operations?|mlops)\b/i,
    text: /\b(?:implementation|solutions?|systems?|integrations?|automation|quality assurance|qa|technical operations?|apis?|databases?|workflow automation|testing|technical support|deployment)\b/i,
  },
  {
    id: "product",
    title: /\b(?:product\s+(?:analyst|intern|associate|operations?|ops|strategy|management)|associate product manager|apm)\b/i,
    text: /\b(?:product strategy|product operations?|roadmap|user research|requirements?|product requirements?|feature|product analytics|customer discovery)\b/i,
  },
  {
    id: "finance_economics",
    title: /\b(?:finance|financial|fp&a|investment|equity research|markets?|treasury|credit|economics?|economic|valuation|pricing|risk)\b/i,
    text: /\b(?:finance|financial|fp&a|investment|markets?|valuation|economics?|economic|pricing|revenue|budget|forecast|credit|portfolio|commercial finance)\b/i,
  },
  {
    id: "analytics",
    title: /\b(?:(?:business|data|product|operations?|growth|revenue|commercial|marketing|risk|strategy)\s+)?analyst\b|\banalytics?\b|\bbusiness intelligence\b/i,
    text: /\b(?:analytics?|analysis|data|sql|excel|spreadsheets?|dashboard|metrics?|insights?|business intelligence|reporting|forecasting)\b/i,
  },
  {
    id: "business_strategy",
    title: /\b(?:strategy|business development|growth|go[- ]?to[- ]?market|gtm|partnerships?|commercial|founder['’]?s office|chief of staff|market research|business associate)\b/i,
    text: /\b(?:strategy|business development|growth|go[- ]?to[- ]?market|gtm|partnerships?|commercial|market research|competitive research|market intelligence|founder['’]?s office)\b/i,
  },
  {
    id: "operations",
    title: /\b(?:operations?|business ops|program(?:me)?|project|process|supply chain|logistics|customer operations?|revenue operations?|people operations?)\b/i,
    text: /\b(?:operations?|process improvement|program management|project management|logistics|supply chain|execution|workflow|service operations?|business ops)\b/i,
  },
  {
    id: "research",
    title: /\b(?:research|research assistant|research associate|market intelligence|industry research|research intern)\b/i,
    text: /\b(?:research|literature review|desk research|evidence synthesis|market intelligence|industry research|primary research|secondary research|policy research)\b/i,
  },
  {
    id: "software_development",
    title: /\b(?:software (?:engineer|engineering|developer|development)|backend (?:engineer|engineering|developer|development)|front[- ]?end (?:engineer|engineering|developer|development)|full[- ]?stack (?:engineer|engineering|developer|development)|mobile (?:engineer|developer)|ios (?:engineer|developer)|android (?:engineer|developer)|sde(?:\s*[1-3])?|machine learning engineer|ml engineer|data engineer|devops engineer)\b/i,
    text: /\b(?:production software|software engineering|backend development|frontend development|full[- ]?stack development|distributed systems|microservices|coding interview|data structures|algorithms)\b/i,
  },
] as const;

const SECTOR_RULES: readonly Array<{ tag: RoleSectorTag; pattern: RegExp }> = [
  { tag: "Health-tech", pattern: /\b(?:health[- ]?tech|healthcare|health care|medical|clinic|patient|pharma|pharmaceutical|biotech|digital health)\b/i },
  { tag: "Policy / governance", pattern: /\b(?:public policy|policy research|government|governance|legislative|public sector|think tank|regulatory policy|development sector)\b/i },
  { tag: "Fintech", pattern: /\b(?:fintech|payments?|banking|financial services|lending|credit platform|digital payments?|neobank)\b/i },
] as const;

export type RoleTaxonomyAssessment = {
  primaryFamily: RoleFamilyDefinition;
  matchedFamilies: RoleFamilyDefinition[];
  preferenceLane: RolePreferenceLane;
  preferenceLabel: string;
  sectorTags: RoleSectorTag[];
  reasons: string[];
};

function scoreFamily(rule: FamilyRule, title: string, text: string) {
  const titleMatch = rule.title.test(title);
  const textMatch = rule.text.test(text);
  return (titleMatch ? 5 : 0) + (textMatch ? 1 : 0);
}

export function classifyRoleTaxonomy(job: { title: string; description?: string | null }): RoleTaxonomyAssessment {
  const title = job.title.replace(/<[^>]+>/g, " ");
  const text = `${title} ${job.description ?? ""}`.replace(/<[^>]+>/g, " ");
  const scored = FAMILY_RULES
    .map((rule, order) => ({ id: rule.id, score: scoreFamily(rule, title, text), order }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);

  const primaryId: RoleFamilyId = scored[0]?.id ?? "generalist";
  const primaryFamily = FAMILY_BY_ID.get(primaryId) ?? FAMILY_BY_ID.get("generalist")!;
  const matchedFamilies = (scored.length ? scored : [{ id: "generalist" as const, score: 0, order: 999 }])
    .slice(0, 3)
    .map((item) => FAMILY_BY_ID.get(item.id)!)
    .filter(Boolean);
  const preferenceLane: RolePreferenceLane = primaryId === "software_development" ? "software_stretch" : "broad_fit";
  const sectorTags = SECTOR_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.tag);

  const reasons = [
    `Primary function: ${primaryFamily.label}`,
    preferenceLane === "software_stretch"
      ? "Pure software-development roles stay visible but are a stretch preference by default"
      : "Role sits inside Scout's broad non-hardcore-SWE opportunity lane",
    ...sectorTags.map((tag) => `Sector context: ${tag}`),
  ];

  return {
    primaryFamily,
    matchedFamilies,
    preferenceLane,
    preferenceLabel: preferenceLane === "software_stretch" ? "Software-development stretch" : "Broad-fit lane",
    sectorTags,
    reasons,
  };
}
