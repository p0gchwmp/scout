export const AI_AGENT_CAPABILITIES = Object.freeze({
  classifyPublishedContacts: true,
  personalizeOutreach: true,
  inventContact: false,
  useUnapprovedClaims: false,
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

export type AiOutreachEnvelope = {
  schemaVersion: 1;
  jobSnapshotId: string;
  companyName: string;
  roleTitle: string;
  candidateName: string;
  contact: AcceptedAgentContact;
  claims: ApprovedAgentClaim[];
  constraints: {
    useOnlyProvidedClaims: true;
    doNotInventMetrics: true;
    doNotInventEligibility: true;
    doNotInventReferrals: true;
    shortNonPushyProfessionalTone: true;
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

function cleanLine(value: string, field: string, max = 500) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max || /[\r\n]/.test(value)) throw new Error(`${field} is invalid`);
  return cleaned;
}

function cleanBody(value: string, field: string, max = 4000) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || /\u0000/.test(value)) throw new Error(`${field} is invalid`);
  return cleaned;
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

export function buildAiOutreachEnvelope(input: {
  jobSnapshotId: string;
  companyName: string;
  roleTitle: string;
  candidateName: string;
  contact: AcceptedAgentContact;
  claims: ApprovedAgentClaim[];
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

  const claims = [...input.claims]
    .map((claim) => {
      if (claim.status !== "approved") throw new Error("AI outreach may use approved claims only");
      return {
        id: cleanLine(claim.id, "Claim id", 200),
        statement: cleanLine(claim.statement, "Claim statement", 1200),
        status: "approved" as const,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!claims.length) throw new Error("AI outreach requires at least one approved claim");
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) throw new Error("AI outreach claim ids must be unique");

  return {
    schemaVersion: 1,
    jobSnapshotId,
    companyName,
    roleTitle,
    candidateName,
    contact,
    claims: claims.slice(0, 8),
    constraints: {
      useOnlyProvidedClaims: true,
      doNotInventMetrics: true,
      doNotInventEligibility: true,
      doNotInventReferrals: true,
      shortNonPushyProfessionalTone: true,
      sendAllowed: false,
    },
  };
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
  return { subject, body, usedClaimIds: [...usedClaimIds].sort() };
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
