export type OfficialContactSourceType =
  | "official_job_posting"
  | "official_careers"
  | "official_contact"
  | "official_company"
  | "official_team"
  | "official_event"
  | "official_press";

type SourceRule = {
  type: Exclude<OfficialContactSourceType, "official_company">;
  label: string;
  scoreBonus: number;
  pattern: RegExp;
  seedPaths: readonly string[];
};

export const OFFICIAL_CONTACT_SOURCE_RULES: readonly SourceRule[] = Object.freeze([
  {
    type: "official_job_posting",
    label: "official job posting",
    scoreBonus: 20,
    pattern: /\/(?:jobs?|positions?|openings?)\/(?:[^/?#]+)(?:[/?#]|$)/i,
    seedPaths: [],
  },
  {
    type: "official_careers",
    label: "official careers/recruiting page",
    scoreBonus: 15,
    pattern: /(?:^|\/)(?:careers?|jobs?|openings?|join(?:-us)?|work-with-us|recruit(?:ing|ment)?|talent|campus|early[-_]?careers?|internships?)(?:\/|$)/i,
    seedPaths: ["/careers", "/jobs", "/early-careers", "/internships"],
  },
  {
    type: "official_event",
    label: "official event/career-fair page",
    scoreBonus: 12,
    pattern: /(?:^|\/)(?:events?|career[-_]?fairs?|campus[-_]?events?|recruiting[-_]?events?)(?:\/|$)/i,
    seedPaths: ["/events"],
  },
  {
    type: "official_team",
    label: "official team/people page",
    scoreBonus: 8,
    pattern: /(?:^|\/)(?:team|people|leadership)(?:\/|$)/i,
    seedPaths: ["/team"],
  },
  {
    type: "official_contact",
    label: "official contact page",
    scoreBonus: 6,
    pattern: /(?:^|\/)(?:contact|contact-us)(?:\/|$)/i,
    seedPaths: ["/contact"],
  },
  {
    type: "official_press",
    label: "official press/news page",
    scoreBonus: 4,
    pattern: /(?:^|\/)(?:press|news|newsroom|media|releases?|press-releases?)(?:\/|$)/i,
    seedPaths: ["/press"],
  },
]);

export const OFFICIAL_CONTACT_CRAWL_SEEDS = Object.freeze([
  ...new Set([
    ...OFFICIAL_CONTACT_SOURCE_RULES.flatMap((rule) => rule.seedPaths),
    "/about",
    "/",
  ]),
]);

function normalizedSurface(url: URL) {
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname}`;
}

export function classifyOfficialContactSource(url: URL): OfficialContactSourceType {
  const surface = normalizedSurface(url);
  for (const rule of OFFICIAL_CONTACT_SOURCE_RULES) {
    if (rule.pattern.test(surface)) return rule.type;
  }
  if (url.hostname.toLowerCase().replace(/^www\./, "").startsWith("careers.")) return "official_careers";
  return "official_company";
}

export function officialContactSourceScoreBonus(sourceType: string | null | undefined) {
  const rule = OFFICIAL_CONTACT_SOURCE_RULES.find((item) => item.type === sourceType);
  return rule?.scoreBonus ?? 0;
}

export function officialContactSourceLabel(sourceType: string | null | undefined) {
  return OFFICIAL_CONTACT_SOURCE_RULES.find((item) => item.type === sourceType)?.label ?? "official company page";
}

export function isOfficialContactResearchLink(url: URL) {
  const source = classifyOfficialContactSource(url);
  return source !== "official_company" || /(?:^|\/)about(?:\/|$)/i.test(url.pathname);
}
