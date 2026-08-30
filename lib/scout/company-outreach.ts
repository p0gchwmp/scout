import { SUMMER_2027_WINDOW } from "./opportunity-tracks.ts";

const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const BLOCKED_HOST_PATTERN = /(^|\.)(linkedin\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|breezy\.hr)$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERAL_RELEVANCE_PATTERN = /\b(product|operations?|research|analysis|data|documentation|workflow|testing|quality|health|policy|finance|economics|business|implementation|prototype|clinic|pharma|ai)\b/i;

export type CompanyOutreachTrack = "now_remote" | "summer_2027";

export type CompanyOutreachTargetInput = {
  companyName: string;
  companyDomain: string;
  officialUrl: string;
  track: CompanyOutreachTrack;
  interestNote: string | null;
};

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  return value as Record<string, unknown>;
}

function singleLine(value: unknown, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max || /[\r\n\0]/.test(value)) throw new Error(`${field} is invalid`);
  return cleaned;
}

function tokens(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 4);
}

export function normalizeCompanyDomain(value: unknown) {
  const domain = singleLine(value, "Company domain", 253).toLowerCase().replace(/^www\./, "");
  if (!DOMAIN_PATTERN.test(domain) || /\.(?:local|internal|invalid|test)$/.test(domain) || BLOCKED_HOST_PATTERN.test(domain)) {
    throw new Error("Company domain must be the official public company domain");
  }
  return domain;
}

export function validateOfficialCompanyUrl(raw: unknown, domain: string) {
  const value = singleLine(raw, "Official company URL", 2000);
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Official company URL is invalid"); }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port || BLOCKED_HOST_PATTERN.test(host)) {
    throw new Error("Official company URL must be a normal HTTPS first-party company page");
  }
  if (host !== domain && !host.endsWith(`.${domain}`)) throw new Error("Official company URL must stay on the declared company domain");
  url.hash = "";
  return url.toString();
}

export function parseCompanyTargetCreatePayload(value: unknown): CompanyOutreachTargetInput {
  const raw = object(value);
  const allowed = new Set(["companyName", "companyDomain", "officialUrl", "track", "interestNote"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("Unexpected company outreach target field");
  const companyName = singleLine(raw.companyName, "Company name", 160);
  const companyDomain = normalizeCompanyDomain(raw.companyDomain);
  const officialUrl = validateOfficialCompanyUrl(raw.officialUrl, companyDomain);
  if (raw.track !== "now_remote" && raw.track !== "summer_2027") throw new Error("Company outreach track is invalid");
  const interestNote = raw.interestNote === undefined || raw.interestNote === null || raw.interestNote === ""
    ? null
    : singleLine(raw.interestNote, "Interest note", 600);
  return { companyName, companyDomain, officialUrl, track: raw.track, interestNote };
}

export function parseTargetIdPayload(value: unknown) {
  const raw = object(value);
  if (Object.keys(raw).some((key) => key !== "targetId")) throw new Error("Unexpected target research field");
  const targetId = singleLine(raw.targetId, "Target id", 160);
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(targetId)) throw new Error("Target id is invalid");
  return { targetId };
}

export function parseCompanyContactReviewPayload(value: unknown) {
  const raw = object(value);
  if (Object.keys(raw).some((key) => key !== "id" && key !== "reviewState")) throw new Error("Unexpected contact review field");
  const id = singleLine(raw.id, "Contact id", 160);
  if (raw.reviewState !== "accepted" && raw.reviewState !== "rejected") throw new Error("Contact review state is invalid");
  return { id, reviewState: raw.reviewState } as const;
}

export function parseCompanyDraftCreatePayload(value: unknown) {
  const raw = object(value);
  if (Object.keys(raw).some((key) => key !== "contactId" && key !== "claimIds")) throw new Error("Unexpected company outreach draft field");
  const contactId = singleLine(raw.contactId, "Contact id", 160);
  if (raw.claimIds === undefined || raw.claimIds === null) return { contactId, claimIds: null as string[] | null };
  if (!Array.isArray(raw.claimIds) || raw.claimIds.length < 1 || raw.claimIds.length > 3) throw new Error("Choose 1-3 approved claims for company-first outreach");
  const claimIds = raw.claimIds.map((value) => singleLine(value, "Claim id", 160));
  if (new Set(claimIds).size !== claimIds.length) throw new Error("Claim ids must be unique");
  return { contactId, claimIds };
}

export function selectCompanyOutreachClaimIds(input: {
  claims: Array<{ id: string; statement: string }>;
  companyName: string;
  researchFocus?: string | null;
  track: CompanyOutreachTrack;
  limit?: number;
}) {
  const context = `${input.companyName} ${input.researchFocus ?? ""} ${input.track === "now_remote" ? "remote product operations business project" : "summer internship product operations business research"}`;
  const contextTokens = new Set(tokens(context));
  const scored = input.claims.map((claim, index) => {
    const statementTokens = tokens(claim.statement);
    const overlap = [...new Set(statementTokens.filter((token) => contextTokens.has(token)))].length;
    const general = GENERAL_RELEVANCE_PATTERN.test(claim.statement) ? 1 : 0;
    return { claim, score: overlap * 5 + general, index };
  }).filter((item) => item.score > 0);
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.slice(0, Math.max(1, Math.min(input.limit ?? 3, 3))).map((item) => item.claim.id);
}

export function parseCompanyDraftReviewPayload(value: unknown) {
  const raw = object(value);
  if (Object.keys(raw).some((key) => !["id", "action", "revisionId"].includes(key))) throw new Error("Unexpected draft review field");
  const id = singleLine(raw.id, "Draft id", 160);
  const revisionId = singleLine(raw.revisionId, "Revision id", 160);
  if (raw.action !== "approve" && raw.action !== "reject") throw new Error("Draft action is invalid");
  return { id, revisionId, action: raw.action } as const;
}

export function parseCompanyGmailDraftPayload(value: unknown) {
  const raw = object(value);
  if (Object.keys(raw).some((key) => key !== "draftId")) throw new Error("Unexpected Gmail draft field");
  return { draftId: singleLine(raw.draftId, "Draft id", 160) };
}

export function companyOutreachRoleLabel(track: CompanyOutreachTrack) {
  return track === "now_remote"
    ? "speculative remote internship or short live project"
    : `speculative Summer 2027 internship (${SUMMER_2027_WINDOW.label})`;
}

export function renderCompanyFirstOutreach(input: {
  candidateName: string;
  companyName: string;
  track: CompanyOutreachTrack;
  interestNote: string | null;
  contactEmail: string;
  claims: Array<{ id: string; statement: string }>;
}) {
  const candidateName = singleLine(input.candidateName, "Candidate name", 160);
  const companyName = singleLine(input.companyName, "Company name", 160);
  const contactEmail = singleLine(input.contactEmail, "Contact email", 320).toLowerCase();
  if (!EMAIL_PATTERN.test(contactEmail)) throw new Error("Contact email is invalid");
  if (!input.claims.length || input.claims.length > 3) throw new Error("1-3 approved claims are required");
  const claims = input.claims.map((claim) => ({ id: singleLine(claim.id, "Claim id", 160), statement: singleLine(claim.statement, "Claim statement", 1200) }));
  const highlights = claims.map((claim) => claim.statement.replace(/[.!?]+$/, ""));
  const background = highlights.length === 1 ? highlights[0] : `${highlights.slice(0, -1).join("; ")}; and ${highlights.at(-1)}`;
  const trackLine = input.track === "now_remote"
    ? `I wanted to ask whether there might be scope to contribute to ${companyName} through a remote internship or short live project alongside college.`
    : `I wanted to ask whether there might be scope for a Summer 2027 internship with ${companyName} during ${SUMMER_2027_WINDOW.label}.`;
  const subject = input.track === "now_remote"
    ? `Exploring a remote internship / project with ${companyName}`
    : `Summer 2027 internship inquiry — ${companyName}`;
  const body = [
    `To: ${contactEmail}`,
    `Subject: ${subject}`,
    "",
    "Hi recruiting team,",
    "",
    `I'm ${candidateName}. ${trackLine}`,
    input.interestNote ? input.interestNote : null,
    `A few relevant things from my background: ${background}.`,
    "",
    "I know there may not be a formal opening right now; I'm reaching out speculatively and would be glad to help on a small, concrete problem where this background is useful.",
    "",
    "Best,",
    candidateName,
  ].filter((line): line is string => line !== null).join("\n");
  return { body, claimIds: claims.map((claim) => claim.id) };
}

export function assertSpeculativeCompanyOutreach(text: string) {
  if (/\b(?:came across|saw|found|applying for|application for)\b[^\n.]{0,90}\b(?:opening|job posting|job listing|advertised role)\b/i.test(text)) {
    throw new Error("Company-first outreach must not claim a formal opening exists");
  }
  if (!/\b(?:speculatively|ask whether|inquiry|might be scope|may not be a formal opening)\b/i.test(text)) {
    throw new Error("Company-first outreach must remain clearly speculative");
  }
  return text;
}
