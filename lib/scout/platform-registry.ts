export type ScoutPlatformKind = "ats" | "job_board" | "form" | "company" | "unknown";
export type DiscoveryMode = "public_api" | "public_page" | "search_index" | "user_session" | "registered_source" | "none";
export type ResolutionMode = "structured" | "official_page" | "browser_capture" | "lead_only";
export type ApplicationMode = "structured_prepare" | "browser_assist" | "reviewed_easy_apply" | "manual";
export type ContactResearchMode = "official_company_sources" | "none";

export type ScoutPlatformId =
  | "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters"
  | "workday" | "bamboohr" | "icims" | "jobvite" | "recruitee" | "teamtailor"
  | "breezyhr" | "jazzhr" | "pinpoint" | "personio" | "rippling" | "freshteam"
  | "zohorecruit" | "oracle" | "successfactors" | "taleo" | "adp" | "eightfold"
  | "phenom" | "avature" | "tally" | "google_forms" | "typeform" | "fillout"
  | "jotform" | "microsoft_forms" | "linkedin" | "internshala" | "glassdoor" | "indeed"
  | "naukri" | "wellfound" | "unstop" | "cutshort" | "foundit" | "company" | "unknown";

export type ScoutPlatformPolicy = {
  id: ScoutPlatformId;
  label: string;
  kind: ScoutPlatformKind;
  discovery: DiscoveryMode;
  resolution: ResolutionMode;
  application: ApplicationMode;
  contactResearch: ContactResearchMode;
  loginMayBeRequired: boolean;
  requiresOfficialResolution: boolean;
  easyApplyAssist: boolean;
  finalSubmitRequiresApproval: true;
  restrictions: readonly string[];
  note: string;
};

type HostRule = { hosts: RegExp; policy: ScoutPlatformPolicy };

function policy(input: Omit<ScoutPlatformPolicy, "finalSubmitRequiresApproval">): ScoutPlatformPolicy {
  return Object.freeze({ ...input, finalSubmitRequiresApproval: true });
}

const officialOnly = ["Never guess or scrape private recruiter contact data."] as const;
const jobBoardRules = [
  "Treat the platform listing as a lead/context source.",
  "Prefer an official company or ATS posting before application automation.",
  "Do not scrape profiles, private contact data, or bypass login/CAPTCHA/rate limits.",
] as const;
const formRules = [
  "Treat the form as an application surface, not proof of the employer or role.",
  "Require upstream official company/job evidence before autofill or application preparation.",
  "Do not bypass CAPTCHA, consent, access controls, or final-submit review.",
  "Do not treat hidden or prefilled form values as approved candidate claims.",
] as const;

export const SCOUT_PLATFORM_POLICIES: readonly ScoutPlatformPolicy[] = Object.freeze([
  policy({ id: "greenhouse", label: "Greenhouse", kind: "ats", discovery: "public_api", resolution: "structured", application: "structured_prepare", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Structured public ATS; first-class discovery and snapshot adapter." }),
  policy({ id: "lever", label: "Lever", kind: "ats", discovery: "public_api", resolution: "structured", application: "structured_prepare", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Structured public ATS; first-class discovery and snapshot adapter." }),
  policy({ id: "ashby", label: "Ashby", kind: "ats", discovery: "public_page", resolution: "structured", application: "structured_prepare", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Structured ATS target; use official posting surfaces and a dedicated adapter." }),
  policy({ id: "workable", label: "Workable", kind: "ats", discovery: "public_page", resolution: "structured", application: "structured_prepare", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Structured ATS target; resolve from official posting evidence." }),
  policy({ id: "smartrecruiters", label: "SmartRecruiters", kind: "ats", discovery: "public_page", resolution: "structured", application: "structured_prepare", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Structured ATS target with official job-posting surfaces." }),
  policy({ id: "workday", label: "Workday", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: ["Do not bypass candidate login, consent, CAPTCHA, or tenant controls."], note: "Dynamic tenant-specific ATS; browser-assisted preparation is safer than pretending there is one universal API." }),
  policy({ id: "bamboohr", label: "BambooHR", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: ["Candidate application APIs are employer-authenticated; Scout must not use employer credentials."], note: "Use public employer careers pages for discovery and candidate-side browser assistance for applications." }),
  policy({ id: "icims", label: "iCIMS", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Enterprise ATS; official posting capture plus reviewed browser assistance." }),
  policy({ id: "jobvite", label: "Jobvite", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Official job page resolution followed by browser-assisted application preparation." }),
  policy({ id: "recruitee", label: "Recruitee", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Public careers pages are suitable discovery targets; application remains reviewed." }),
  policy({ id: "teamtailor", label: "Teamtailor", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Public careers pages plus browser-assisted application preparation." }),
  policy({ id: "breezyhr", label: "Breezy HR", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Public careers pages plus reviewed browser assistance." }),
  policy({ id: "jazzhr", label: "JazzHR", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Common apply-to-job surface; capture official posting evidence before autofill." }),
  policy({ id: "pinpoint", label: "Pinpoint", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Official careers page resolution plus reviewed form assistance." }),
  policy({ id: "personio", label: "Personio", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Official employer job pages can seed Scout snapshots." }),
  policy({ id: "rippling", label: "Rippling ATS", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Public job pages plus reviewed browser assistance." }),
  policy({ id: "freshteam", label: "Freshteam", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Public employer job pages are suitable resolution targets." }),
  policy({ id: "zohorecruit", label: "Zoho Recruit", kind: "ats", discovery: "public_page", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Public career-site evidence plus reviewed browser assistance." }),
  policy({ id: "oracle", label: "Oracle Recruiting", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: ["Do not bypass candidate accounts, consent, or anti-bot controls."], note: "Enterprise recruiting cloud; browser-assisted candidate flow." }),
  policy({ id: "successfactors", label: "SAP SuccessFactors", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: ["Do not bypass candidate accounts, consent, or anti-bot controls."], note: "Enterprise ATS; browser-assisted candidate flow." }),
  policy({ id: "taleo", label: "Oracle Taleo", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: ["Do not bypass candidate accounts, consent, or anti-bot controls."], note: "Legacy enterprise ATS; preserve official posting and assist the visible candidate flow." }),
  policy({ id: "adp", label: "ADP Recruiting", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Enterprise ATS; use official job pages and reviewed form assistance." }),
  policy({ id: "eightfold", label: "Eightfold", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "AI recruiting platform; candidate-side browser assistance only." }),
  policy({ id: "phenom", label: "Phenom", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Career-experience platform; resolve official posting and assist candidate-side forms." }),
  policy({ id: "avature", label: "Avature", kind: "ats", discovery: "public_page", resolution: "browser_capture", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: true, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Enterprise recruiting platform; reviewed candidate-side assistance." }),

  policy({ id: "tally", label: "Tally", kind: "form", discovery: "none", resolution: "browser_capture", application: "browser_assist", contactResearch: "none", loginMayBeRequired: false, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: formRules, note: "Standalone or embedded Tally application form. Require official company/job provenance first; custom-domain Tally forms must also be detected by the browser worker." }),
  policy({ id: "google_forms", label: "Google Forms", kind: "form", discovery: "none", resolution: "browser_capture", application: "browser_assist", contactResearch: "none", loginMayBeRequired: false, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: formRules, note: "Form application surface. Resolve employer and role evidence before assisting visible fields." }),
  policy({ id: "typeform", label: "Typeform", kind: "form", discovery: "none", resolution: "browser_capture", application: "browser_assist", contactResearch: "none", loginMayBeRequired: false, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: formRules, note: "Form application surface. Resolve employer and role evidence before assisting visible fields." }),
  policy({ id: "fillout", label: "Fillout", kind: "form", discovery: "none", resolution: "browser_capture", application: "browser_assist", contactResearch: "none", loginMayBeRequired: false, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: formRules, note: "Form application surface. Resolve employer and role evidence before assisting visible fields." }),
  policy({ id: "jotform", label: "Jotform", kind: "form", discovery: "none", resolution: "browser_capture", application: "browser_assist", contactResearch: "none", loginMayBeRequired: false, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: formRules, note: "Form application surface. Resolve employer and role evidence before assisting visible fields." }),
  policy({ id: "microsoft_forms", label: "Microsoft Forms", kind: "form", discovery: "none", resolution: "browser_capture", application: "browser_assist", contactResearch: "none", loginMayBeRequired: false, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: formRules, note: "Form application surface. Resolve employer and role evidence before assisting visible fields." }),

  policy({ id: "linkedin", label: "LinkedIn", kind: "job_board", discovery: "user_session", resolution: "lead_only", application: "reviewed_easy_apply", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: true, restrictions: [...jobBoardRules, "Never mass-automate LinkedIn search or Easy Apply; respect platform limits and require user review."], note: "Use LinkedIn Search as a lead/context surface. Easy Apply may be browser-assisted after review, but Scout does not scrape recruiter profiles or private emails." }),
  policy({ id: "internshala", label: "Internshala", kind: "job_board", discovery: "user_session", resolution: "lead_only", application: "browser_assist", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "Internship board lead source; preserve listing evidence and prefer official company/ATS posting where available." }),
  policy({ id: "glassdoor", label: "Glassdoor", kind: "job_board", discovery: "search_index", resolution: "lead_only", application: "manual", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "Discovery/context lead only; resolve to employer/ATS before application automation." }),
  policy({ id: "indeed", label: "Indeed", kind: "job_board", discovery: "search_index", resolution: "lead_only", application: "browser_assist", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "Job-board lead source; prefer official company or ATS application URL." }),
  policy({ id: "naukri", label: "Naukri", kind: "job_board", discovery: "user_session", resolution: "lead_only", application: "browser_assist", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "India job-board lead source; official posting resolution preferred." }),
  policy({ id: "wellfound", label: "Wellfound", kind: "job_board", discovery: "user_session", resolution: "lead_only", application: "browser_assist", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "Startup lead source; resolve employer/ATS posting where available." }),
  policy({ id: "unstop", label: "Unstop", kind: "job_board", discovery: "user_session", resolution: "lead_only", application: "browser_assist", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "Opportunity-board lead source with reviewed browser assistance." }),
  policy({ id: "cutshort", label: "Cutshort", kind: "job_board", discovery: "user_session", resolution: "lead_only", application: "browser_assist", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "India/startup lead source; resolve official employer evidence before deeper automation." }),
  policy({ id: "foundit", label: "Foundit", kind: "job_board", discovery: "user_session", resolution: "lead_only", application: "browser_assist", contactResearch: "none", loginMayBeRequired: true, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: jobBoardRules, note: "India job-board lead source; official posting resolution preferred." }),
]);

const byId = new Map(SCOUT_PLATFORM_POLICIES.map((item) => [item.id, item]));

const hostRules: HostRule[] = [
  [/(^|\.)greenhouse\.io$/i, "greenhouse"], [/(^|\.)lever\.co$/i, "lever"], [/(^|\.)ashbyhq\.com$/i, "ashby"],
  [/(^|\.)workable\.com$/i, "workable"], [/(^|\.)smartrecruiters\.com$/i, "smartrecruiters"],
  [/(^|\.)(myworkdayjobs|myworkdaysite)\.com$/i, "workday"], [/(^|\.)bamboohr\.com$/i, "bamboohr"],
  [/(^|\.)icims\.com$/i, "icims"], [/(^|\.)jobvite\.com$/i, "jobvite"], [/(^|\.)recruitee\.com$/i, "recruitee"],
  [/(^|\.)teamtailor\.com$/i, "teamtailor"], [/(^|\.)breezy\.hr$/i, "breezyhr"], [/(^|\.)applytojob\.com$/i, "jazzhr"],
  [/(^|\.)pinpointhq\.com$/i, "pinpoint"], [/(^|\.)jobs\.personio\.(com|de)$/i, "personio"], [/(^|\.)rippling\.com$/i, "rippling"],
  [/(^|\.)freshteam\.com$/i, "freshteam"], [/(^|\.)zohorecruit\.(com|in)$/i, "zohorecruit"],
  [/(^|\.)oraclecloud\.com$/i, "oracle"], [/(^|\.)successfactors\.(com|eu)$/i, "successfactors"], [/(^|\.)taleo\.net$/i, "taleo"],
  [/(^|\.)adp\.com$/i, "adp"], [/(^|\.)eightfold\.ai$/i, "eightfold"], [/(^|\.)phenompeople\.com$/i, "phenom"], [/(^|\.)avature\.net$/i, "avature"],
  [/(^|\.)tally\.so$/i, "tally"], [/(^|\.)typeform\.com$/i, "typeform"], [/(^|\.)fillout\.com$/i, "fillout"],
  [/(^|\.)jotform\.com$/i, "jotform"], [/(^|\.)forms\.office\.com$/i, "microsoft_forms"], [/(^|\.)forms\.microsoft\.com$/i, "microsoft_forms"],
  [/(^|\.)linkedin\.com$/i, "linkedin"], [/(^|\.)internshala\.com$/i, "internshala"], [/(^|\.)glassdoor\.(com|co\.in)$/i, "glassdoor"],
  [/(^|\.)indeed\.(com|co\.in)$/i, "indeed"], [/(^|\.)naukri\.com$/i, "naukri"], [/(^|\.)wellfound\.com$/i, "wellfound"],
  [/(^|\.)unstop\.com$/i, "unstop"], [/(^|\.)cutshort\.io$/i, "cutshort"], [/(^|\.)foundit\.(in|com)$/i, "foundit"],
].map(([hosts, id]) => ({ hosts: hosts as RegExp, policy: byId.get(id as ScoutPlatformId)! }));

export const GENERIC_COMPANY_POLICY = policy({ id: "company", label: "Company careers site", kind: "company", discovery: "registered_source", resolution: "official_page", application: "browser_assist", contactResearch: "official_company_sources", loginMayBeRequired: false, requiresOfficialResolution: false, easyApplyAssist: false, restrictions: officialOnly, note: "Direct company site. Capture official evidence, prepare a reviewed packet, and use browser assistance only after inspecting the form." });
export const UNKNOWN_PLATFORM_POLICY = policy({ id: "unknown", label: "Unknown", kind: "unknown", discovery: "none", resolution: "lead_only", application: "manual", contactResearch: "none", loginMayBeRequired: false, requiresOfficialResolution: true, easyApplyAssist: false, restrictions: ["Do not fetch or automate an unrecognized target until it is reviewed and registered."], note: "Invalid or unsupported application URL." });

export function getPlatformPolicy(id: ScoutPlatformId): ScoutPlatformPolicy {
  if (id === "company") return GENERIC_COMPANY_POLICY;
  if (id === "unknown") return UNKNOWN_PLATFORM_POLICY;
  return byId.get(id) ?? UNKNOWN_PLATFORM_POLICY;
}

export function classifyPlatformUrl(value: string): ScoutPlatformPolicy {
  let url: URL;
  try { url = new URL(value); }
  catch { return UNKNOWN_PLATFORM_POLICY; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return UNKNOWN_PLATFORM_POLICY;
  if ((url.hostname.toLowerCase() === "docs.google.com" && url.pathname.startsWith("/forms/")) || url.hostname.toLowerCase() === "forms.gle") {
    return getPlatformPolicy("google_forms");
  }
  return hostRules.find((item) => item.hosts.test(url.hostname))?.policy ?? GENERIC_COMPANY_POLICY;
}

export const PLATFORM_ROADMAP = Object.freeze({
  structuredFirst: ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"] as ScoutPlatformId[],
  browserAssistNext: ["workday", "bamboohr", "icims", "jobvite", "recruitee", "teamtailor", "breezyhr", "jazzhr", "pinpoint", "personio", "rippling", "freshteam", "zohorecruit"] as ScoutPlatformId[],
  formApplications: ["tally", "google_forms", "typeform", "fillout", "jotform", "microsoft_forms"] as ScoutPlatformId[],
  jobBoardLeadCoverage: ["linkedin", "internshala", "glassdoor", "indeed", "naukri", "wellfound", "unstop", "cutshort", "foundit"] as ScoutPlatformId[],
  enterpriseLongTail: ["oracle", "successfactors", "taleo", "adp", "eightfold", "phenom", "avature"] as ScoutPlatformId[],
});