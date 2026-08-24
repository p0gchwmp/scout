import { assertNoNewAnchoredFacts, HUMAN_WRITING_STYLE_VERSION, lintHumanWriting } from "./human-writing.ts";

export const AI_AGENT_CAPABILITIES = Object.freeze({
  classifyPublishedContacts: true,
  personalizeOutreach: true,
  draftApplicationAnswers: true,
  inventContact: false,
  useUnapprovedClaims: false,
  answerSensitiveApplicationQuestions: false,
  sendEmail: false,
  submitApplication: false,
} as const);

export type ApprovedAgentClaim = {
  id: string;
  statement: string;
  status: "approved";
};

export type AcceptedAgentContact = {
  id: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  reviewState: "accepted";
};

export type AgentWritingVoice = {
  sample: string | null;
  styleNote: string | null;
};

export type AiOutreachEnvelope = {
  schemaVersion: 1;
  jobSnapshotId: string;
  companyName: string;
  roleTitle: string;
  candidateName: string;
  contact: AcceptedAgentContact;
  claims: ApprovedAgentClaim[];
  voice: AgentWritingVoice;
  constraints: {
    useOnlyProvidedClaims: true;
    preserveClaimMeaning: true;
    doNotInventMetrics: true;
    doNotInventEligibility: true;
    doNotInventReferrals: true;
    shortNonPushyProfessionalTone: true;
    humanWritingStyleVersion: 1;
    sendAllowed: false;
  };
};

export type AiOutreachResult = {
  subject: string;
  body: string;
  usedClaimIds: string[];
};

export type PublishedContactCandidate = {
  id: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType: string;
};

export type AiContactClassification = {
  candidateId: string;
  suitability: "high" | "review" | "reject";
  reason: string;
};

export type ApplicationQuestion = {
  id: string;
  label: string;
  maxLength: number | null;
};

export type AiApplicationAnswerEnvelope = {
  schemaVersion: 1;
  jobSnapshotId: string;
  companyName: string;
  roleTitle: string;
  jobDescription: string;
  candidateName: string;
  questions: ApplicationQuestion[];
  claims: ApprovedAgentClaim[];
  voice: AgentWritingVoice;
  constraints: {
    useOnlyProvidedClaims: true;
    preserveClaimMeaning: true;
    doNotInventMetrics: true;
    doNotInventEligibility: true;
    doNotAnswerSensitiveQuestions: true;
    humanWritingStyleVersion: 1;
    submitAllowed: false;
  };
};

export type AiApplicationAnswer = {
  questionId: string;
  answer: string;
  usedClaimIds: string[];
};

const SENSITIVE_APPLICATION_QUESTION = /captcha|password|passcode|mfa|otp|signature|gender|pronoun|race|ethnicity|disability|veteran|date of birth|\bdob\b|age|work authori[sz]ation|eligible to work|visa|sponsorship|salary|compensation|notice period|availability|start date|consent|privacy|background check|criminal|citizenship|nationality|marital|religion|sexual orientation/i;

function cleanLine(value: string, field: string, max = 500) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max || /[\r\n]/.test(value)) throw new Error(`${field} is invalid`);
  return cleaned;
}

function cleanBody(value: string, field: string, max = 4000) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || value.includes(String.fromCharCode(0))) throw new Error(`${field} is invalid`);
  return cleaned;
}

function cleanOptionalBody(value: string | null | undefined, field: string, max: number) {
  if (value === null || value === undefined || !String(value).trim()) return null;
  return cleanBody(String(value), field, max);
}

function cleanEmail(value: string) {
  const email = cleanLine(value, "Contact email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Contact email is invalid");
  return email;
}

function cleanUrl(value: string) {
  const candidate = cleanLine(value, "Source URL", 2000);
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:") throw new Error("Source URL must use HTTPS");
  return parsed.toString();
}

function normalizeClaims(input: ApprovedAgentClaim[]) {
  const claims = [...input]
    .map((claim) => {
      if (claim.status !== "approved") throw new Error("AI writing may use approved claims only");
      return {
        id: cleanLine(claim.id, "Claim id", 200),
        statement: cleanLine(claim.statement, "Claim statement", 1200),
        status: "approved" as const,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!claims.length) throw new Error("AI writing requires at least one approved claim");
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) throw new Error("AI writing claim ids must be unique");
  return claims.slice(0, 8);
}

function normalizeVoice(value?: Partial<AgentWritingVoice> | null): AgentWritingVoice {
  return {
    sample: cleanOptionalBody(value?.sample, "Writing sample", 6000),
    styleNote: cleanOptionalBody(value?.styleNote, "Writing style note", 1200),
  };
}

export function buildAiOutreachEnvelope(input: {
  jobSnapshotId: string;
  companyName: string;
  roleTitle: string;
  candidateName: string;
  contact: AcceptedAgentContact;
  claims: ApprovedAgentClaim[];
  voice?: Partial<AgentWritingVoice> | null;
}): AiOutreachEnvelope {
  const jobSnapshotId = cleanLine(input.jobSnapshotId, "Job snapshot id", 200);
  const companyName = cleanLine(input.companyName, "Company name", 200);
  const roleTitle = cleanLine(input.roleTitle, "Role title", 240);
  const candidateName = cleanLine(input.candidateName, "Candidate name", 160);
  if (input.contact.reviewState !== "accepted") throw new Error("AI outreach requires accepted contact evidence");

  const contact: AcceptedAgentContact = {
    id: cleanLine(input.contact.id, "Contact id", 200),
    email: cleanEmail(input.contact.email),
    sourceUrl: cleanUrl(input.contact.sourceUrl),
    excerpt: cleanBody(input.contact.excerpt, "Contact excerpt", 2000),
    reviewState: "accepted",
  };

  return {
    schemaVersion: 1,
    jobSnapshotId,
    companyName,
    roleTitle,
    candidateName,
    contact,
    claims: normalizeClaims(input.claims),
    voice: normalizeVoice(input.voice),
    constraints: {
      useOnlyProvidedClaims: true,
      preserveClaimMeaning: true,
      doNotInventMetrics: true,
      doNotInventEligibility: true,
      doNotInventReferrals: true,
      shortNonPushyProfessionalTone: true,
      humanWritingStyleVersion: HUMAN_WRITING_STYLE_VERSION,
      sendAllowed: false,
    },
  };
}

function allowedOutreachFacts(envelope: AiOutreachEnvelope) {
  return JSON.stringify({
    jobSnapshotId: envelope.jobSnapshotId,
    companyName: envelope.companyName,
    roleTitle: envelope.roleTitle,
    candidateName: envelope.candidateName,
    contact: envelope.contact,
    claims: envelope.claims,
  });
}

export function validateAiOutreachResult(value: unknown, envelope: AiOutreachEnvelope): AiOutreachResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI outreach result must be an object");
  const result = value as Record<string, unknown>;
  const subject = cleanLine(String(result.subject ?? ""), "AI subject", 180);
  const body = cleanBody(String(result.body ?? ""), "AI body", 4000);
  if (!Array.isArray(result.usedClaimIds) || result.usedClaimIds.length < 1 || result.usedClaimIds.length > envelope.claims.length) {
    throw new Error("AI outreach must report the claim ids it used");
  }
  const usedClaimIds = result.usedClaimIds.map((id) => cleanLine(String(id), "Used claim id", 200));
  if (new Set(usedClaimIds).size !== usedClaimIds.length) throw new Error("AI used claim ids must be unique");
  const allowed = new Set(envelope.claims.map((claim) => claim.id));
  if (usedClaimIds.some((id) => !allowed.has(id))) throw new Error("AI outreach referenced an unapproved claim id");
  assertNoNewAnchoredFacts(`${subject}\n${body}`, allowedOutreachFacts(envelope));
  return { subject, body, usedClaimIds: [...usedClaimIds].sort() };
}

export function isSensitiveApplicationQuestion(label: string) {
  return SENSITIVE_APPLICATION_QUESTION.test(label);
}

export function buildAiApplicationAnswerEnvelope(input: {
  jobSnapshotId: string;
  companyName: string;
  roleTitle: string;
  jobDescription: string;
  candidateName: string;
  questions: ApplicationQuestion[];
  claims: ApprovedAgentClaim[];
  voice?: Partial<AgentWritingVoice> | null;
}): AiApplicationAnswerEnvelope {
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 12) throw new Error("1-12 application questions are required");
  const questions = input.questions.map((question) => {
    const id = cleanLine(question.id, "Application question id", 200);
    const label = cleanLine(question.label, "Application question", 1000);
    if (isSensitiveApplicationQuestion(label)) throw new Error(`Sensitive application question requires manual confirmation: ${label}`);
    const maxLength = question.maxLength === null || question.maxLength === undefined
      ? null
      : Number.isInteger(question.maxLength) && question.maxLength >= 40 && question.maxLength <= 5000
        ? question.maxLength
        : (() => { throw new Error("Application question maxLength is invalid"); })();
    return { id, label, maxLength };
  });
  if (new Set(questions.map((question) => question.id)).size !== questions.length) throw new Error("Application question ids must be unique");
  return {
    schemaVersion: 1,
    jobSnapshotId: cleanLine(input.jobSnapshotId, "Job snapshot id", 200),
    companyName: cleanLine(input.companyName, "Company name", 200),
    roleTitle: cleanLine(input.roleTitle, "Role title", 240),
    jobDescription: cleanBody(input.jobDescription, "Job description", 12_000),
    candidateName: cleanLine(input.candidateName, "Candidate name", 160),
    questions,
    claims: normalizeClaims(input.claims),
    voice: normalizeVoice(input.voice),
    constraints: {
      useOnlyProvidedClaims: true,
      preserveClaimMeaning: true,
      doNotInventMetrics: true,
      doNotInventEligibility: true,
      doNotAnswerSensitiveQuestions: true,
      humanWritingStyleVersion: HUMAN_WRITING_STYLE_VERSION,
      submitAllowed: false,
    },
  };
}

function allowedApplicationFacts(envelope: AiApplicationAnswerEnvelope) {
  return JSON.stringify({
    jobSnapshotId: envelope.jobSnapshotId,
    companyName: envelope.companyName,
    roleTitle: envelope.roleTitle,
    jobDescription: envelope.jobDescription,
    candidateName: envelope.candidateName,
    claims: envelope.claims,
  });
}

export function validateAiApplicationAnswers(value: unknown, envelope: AiApplicationAnswerEnvelope): AiApplicationAnswer[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI application-answer result must be an object");
  const rawAnswers = (value as { answers?: unknown }).answers;
  if (!Array.isArray(rawAnswers) || rawAnswers.length !== envelope.questions.length) throw new Error("AI must answer each supplied non-sensitive application question exactly once");
  const questions = new Map(envelope.questions.map((question) => [question.id, question]));
  const allowedClaims = new Set(envelope.claims.map((claim) => claim.id));
  const seen = new Set<string>();
  return rawAnswers.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI application answer must be an object");
    const record = raw as Record<string, unknown>;
    const questionId = cleanLine(String(record.questionId ?? ""), "Application answer question id", 200);
    const question = questions.get(questionId);
    if (!question || seen.has(questionId)) throw new Error("AI application answer referenced an unknown or duplicate question id");
    seen.add(questionId);
    const answer = cleanBody(String(record.answer ?? ""), "Application answer", question.maxLength ?? 2500);
    if (!Array.isArray(record.usedClaimIds) || record.usedClaimIds.length < 1 || record.usedClaimIds.length > envelope.claims.length) {
      throw new Error("AI application answers must report at least one approved claim id");
    }
    const usedClaimIds = record.usedClaimIds.map((claimId) => cleanLine(String(claimId), "Application answer claim id", 200));
    if (new Set(usedClaimIds).size !== usedClaimIds.length || usedClaimIds.some((claimId) => !allowedClaims.has(claimId))) {
      throw new Error("AI application answer referenced an unapproved claim id");
    }
    assertNoNewAnchoredFacts(answer, allowedApplicationFacts(envelope));
    return { questionId, answer, usedClaimIds: [...usedClaimIds].sort() };
  });
}

export function applicationAnswerStyleWarnings(answers: AiApplicationAnswer[], voiceSample?: string | null) {
  return answers.flatMap((answer) => lintHumanWriting(answer.answer, "application_answer", voiceSample).map((warning) => ({ questionId: answer.questionId, ...warning })));
}

export function buildPublishedContactClassificationInput(candidates: PublishedContactCandidate[]) {
  if (!candidates.length || candidates.length > 50) throw new Error("1-50 published contact candidates are required");
  const normalized = candidates.map((candidate) => ({
    id: cleanLine(candidate.id, "Contact candidate id", 200),
    email: cleanEmail(candidate.email),
    sourceUrl: cleanUrl(candidate.sourceUrl),
    excerpt: cleanBody(candidate.excerpt, "Contact candidate excerpt", 2000),
    sourceType: cleanLine(candidate.sourceType, "Contact source type", 100),
  }));
  if (new Set(normalized.map((candidate) => candidate.id)).size !== normalized.length) throw new Error("Contact candidate ids must be unique");
  return {
    schemaVersion: 1 as const,
    candidates: normalized,
    instruction: "Classify only these explicitly published candidates. Never invent, infer, or transform an email address." as const,
  };
}

export function validateAiContactClassifications(value: unknown, candidateIds: string[]): AiContactClassification[] {
  if (!Array.isArray(value)) throw new Error("AI contact classifications must be an array");
  const allowed = new Set(candidateIds);
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI contact classification must be an object");
    const record = raw as Record<string, unknown>;
    const candidateId = cleanLine(String(record.candidateId ?? ""), "Candidate id", 200);
    if (!allowed.has(candidateId)) throw new Error("AI classified a contact candidate that was not provided");
    if (seen.has(candidateId)) throw new Error("AI contact classifications must be unique by candidate id");
    seen.add(candidateId);
    if (record.suitability !== "high" && record.suitability !== "review" && record.suitability !== "reject") {
      throw new Error("AI contact suitability is invalid");
    }
    return {
      candidateId,
      suitability: record.suitability,
      reason: cleanLine(String(record.reason ?? ""), "Classification reason", 500),
    } as AiContactClassification;
  });
}
