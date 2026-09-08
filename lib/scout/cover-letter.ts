export const COVER_LETTER_TEMPLATE_VERSION = 1;
export const COVER_LETTER_MARKER = "---\nCover letter\n";

export type CoverLetterProfile = {
  university?: string | null;
  program?: string | null;
  graduationYear?: string | null;
  currentLocation?: string | null;
};

export type CoverLetterInput = {
  candidateName: string;
  companyName: string;
  roleTitle: string;
  purpose: "formal_role" | "speculative_company";
  opportunityContext?: string | null;
  profile?: CoverLetterProfile | null;
  claims: Array<{ id: string; statement: string }>;
};

function cleanLine(value: string, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max || /[\r\n\0]/.test(value)) throw new Error(`${field} is invalid`);
  return cleaned;
}

function cleanOptional(value: string | null | undefined, max: number) {
  if (!value?.trim()) return null;
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;
}

function sentence(value: string) {
  const cleaned = value.trim();
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function tokens(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 4);
}

const POLICY_HEALTH = /\b(policy|public health|healthcare|health|government|research|amr|antibiotic|adr|pharmacovigilance|wash|nhm|gmc|clinical)\b/i;
const POLICY_EXAMPLE = /\b(nhm|national health mission|gmc|government medical college|adr|pharmacovigilance|hand[- ]?hygiene|wash|amr|antimicrobial|antibiotic|public[- ]policy coursework)\b/i;
const PRODUCT_STARTUP = /\b(product|startup|operations?|workflow|prototype|consumer|business|clinic|aastha|copium|testing|qa|delivery)\b/i;
const PRODUCT_EXAMPLE = /\b(aastha|copium|scout|multi[- ]?clinic|cms|workflow|prototype|product|operations?|testing|qa)\b/i;
const CONSUMER_STARTUP = /\b(consumer|startup|brand|fmcg|beverage|soda|market|go[- ]?to[- ]?market|gen z|portfolio|validation)\b/i;
const COPIUM_EXAMPLE = /\b(copium|roselle|botanical soda|four[- ]?flavour|campus[- ]?first|i-hub|startup odisha)\b/i;
const GENERIC_PROFILE = /\b(student|university|institute|cgpa|graduat|coursework|class x|class xii)\b/i;

function evidenceExamples(input: CoverLetterInput) {
  const context = `${input.roleTitle} ${input.opportunityContext ?? ""}`;
  const contextTokens = new Set(tokens(context));
  const policyLane = POLICY_HEALTH.test(context);
  const startupLane = PRODUCT_STARTUP.test(context);
  const consumerLane = CONSUMER_STARTUP.test(context);
  const scored = input.claims.map((claim, index) => {
    const statement = cleanLine(claim.statement, `Claim ${index + 1}`, 1200);
    const statementTokens = tokens(statement);
    const overlap = [...new Set(statementTokens.filter((token) => contextTokens.has(token)))].length;
    let lane = 0;
    if (policyLane && POLICY_EXAMPLE.test(statement)) lane += 18;
    else if (policyLane && POLICY_HEALTH.test(statement)) lane += 6;
    if (startupLane && PRODUCT_EXAMPLE.test(statement)) lane += 12;
    else if (startupLane && PRODUCT_STARTUP.test(statement)) lane += 5;
    if (consumerLane && COPIUM_EXAMPLE.test(statement)) lane += 18;
    if (!policyLane && !startupLane && (POLICY_EXAMPLE.test(statement) || PRODUCT_EXAMPLE.test(statement))) lane += 3;
    const profilePenalty = GENERIC_PROFILE.test(statement) && !POLICY_EXAMPLE.test(statement) && !PRODUCT_EXAMPLE.test(statement) ? 12 : 0;
    return { id: cleanLine(claim.id, `Claim ${index + 1} id`, 160), statement, score: overlap * 3 + lane - profilePenalty, index };
  });
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.slice(0, 2);
}

function studentLine(profile: CoverLetterProfile | null | undefined) {
  const university = cleanOptional(profile?.university, 200);
  const program = cleanOptional(profile?.program, 200);
  if (program && university) return `I am a ${program} student at ${university}.`;
  if (university) return `I am a student at ${university}.`;
  if (program) return `I am currently studying ${program}.`;
  return null;
}

function focusSentence(context: string | null | undefined) {
  const cleaned = cleanOptional(context, 320);
  if (!cleaned) return null;
  const firstSentence = cleaned.match(/^(.{30,280}?[.!?])(?:\s|$)/)?.[1] ?? cleaned.slice(0, 260);
  const focus = firstSentence
    .replace(/[.!?]+$/, "")
    .replace(/^(?:the\s+)?(?:role|opportunity)\s+(?:will|would)\s+/i, "")
    .replace(/^(?:you\s+will\s+|work(?:ing)?\s+on\s+|help(?:ing)?\s+|responsible\s+for\s+)/i, "")
    .replace(/^the\s+/i, "")
    .trim();
  if (!focus) return null;
  return `What interests me most is the opportunity's focus on ${focus.charAt(0).toLowerCase()}${focus.slice(1)}.`;
}

export function renderCoverLetter(input: CoverLetterInput) {
  const candidateName = cleanLine(input.candidateName, "Candidate name", 160);
  const companyName = cleanLine(input.companyName, "Company name", 200);
  const roleTitle = cleanLine(input.roleTitle, "Role title", 260);
  if (!Array.isArray(input.claims) || input.claims.length < 1 || input.claims.length > 10) {
    throw new Error("Cover letter requires 1-10 approved claim candidates");
  }
  const selected = evidenceExamples(input);
  if (!selected.length) throw new Error("Cover letter requires at least one approved claim");

  const opening = input.purpose === "speculative_company"
    ? `I am writing to explore the possibility of a ${roleTitle} with ${companyName}.`
    : `I am applying for the ${roleTitle} opportunity at ${companyName}.`;
  const study = studentLine(input.profile);
  const focus = focusSentence(input.opportunityContext);
  const first = sentence(selected[0].statement);
  const second = selected[1] ? sentence(selected[1].statement) : null;

  const body = [
    "Dear Hiring Team,",
    "",
    opening,
    study,
    "Most of my work so far has sat between analysis and execution: understanding a messy problem, structuring it, and then building or testing something concrete.",
    focus,
    "",
    `One relevant example is this: ${first}`,
    "That experience taught me to connect user or stakeholder needs with operational constraints, evidence, and implementation rather than treating them as separate problems.",
    second ? `A second example is: ${second}` : null,
    "",
    input.purpose === "speculative_company"
      ? `I would value the chance to contribute to a small, concrete problem at ${companyName} where this background is useful, while learning from the team.`
      : `I would value the opportunity to contribute to the work behind this role at ${companyName} while learning from the team.` ,
    "Thank you for considering my interest. I would be glad to discuss where my experience could be useful.",
    "",
    "Sincerely,",
    candidateName,
  ].filter((line): line is string => line !== null).join("\n");

  validateCoverLetter(body);
  return { body, claimIds: selected.map((claim) => claim.id), templateVersion: COVER_LETTER_TEMPLATE_VERSION };
}

export function validateCoverLetter(value: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Cover letter is required");
  if (/\[\[[^\]]+\]\]/.test(value)) throw new Error("Cover letter still contains an unreplaced template placeholder");
  if (/\0/.test(value)) throw new Error("Cover letter is invalid");
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  if (words < 140 || words > 550) throw new Error("Cover letter must stay within a one-page review range");
  return value.trim();
}

export function combineOutreachAndCoverLetter(emailDraft: string, coverLetter: string) {
  const email = emailDraft.replace(/\r\n/g, "\n").trim();
  if (!/^To:\s*[^\n]+\nSubject:\s*[^\n]+/i.test(email)) throw new Error("Outreach draft must include pinned To and Subject headers");
  const letter = validateCoverLetter(coverLetter);
  if (email.includes(COVER_LETTER_MARKER)) throw new Error("Outreach draft already contains a cover letter");
  return `${email}\n\n${COVER_LETTER_MARKER}\n${letter}`;
}

export function splitOutreachBundle(value: string) {
  const normalized = value.replace(/\r\n/g, "\n");
  const marker = `\n\n${COVER_LETTER_MARKER}\n`;
  const index = normalized.indexOf(marker);
  if (index < 0) return { emailDraft: normalized.trim(), coverLetter: null };
  if (normalized.indexOf(marker, index + marker.length) >= 0) throw new Error("Outreach draft contains multiple cover letters");
  const emailDraft = normalized.slice(0, index).trim();
  const coverLetter = validateCoverLetter(normalized.slice(index + marker.length));
  return { emailDraft, coverLetter };
}
