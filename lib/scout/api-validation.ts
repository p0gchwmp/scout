export class PayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadValidationError";
  }
}

const ID_MAX = 128;
const CANDIDATE_NAME_MAX = 120;

const PROFILE_KEY_MAX = 64;
const PROFILE_VALUE_MAX = 2000;
const PROFILE_EVIDENCE_MAX = 4000;
const ALLOWED_PROFILE_KEYS = new Set([
  "full_name", "email", "phone", "current_location", "university", "program", "graduation_year",
  "linkedin_url", "github_url", "portfolio_url", "resume_reference", "writing_sample", "writing_style_note",
]);

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function hasUnsafeMultilineControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\n" || character === "\r" || character === "\t") return false;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PayloadValidationError("A JSON object is required");
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, max: number, singleLine = false): string {
  if (typeof value !== "string") throw new PayloadValidationError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || hasControlCharacters(value) || (singleLine && /[\r\n]/.test(value))) {
    throw new PayloadValidationError(`${field} is invalid or exceeds its size limit`);
  }
  return normalized;
}

function boundedMultilineString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new PayloadValidationError(`${field} is required`);
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized || normalized.length > max || hasUnsafeMultilineControlCharacters(value)) {
    throw new PayloadValidationError(`${field} is invalid or exceeds its size limit`);
  }
  return normalized;
}

function id(value: unknown, field: string): string {
  return boundedString(value, field, ID_MAX, true);
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) {
    throw new PayloadValidationError("A valid expectedVersion is required");
  }
  return value as number;
}

function optionalHttpsUrl(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  const raw = boundedString(value, field, 2000, true);
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new PayloadValidationError(`${field} must be a valid HTTPS URL`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new PayloadValidationError(`${field} must be a valid HTTPS URL`);
  }
  return parsed.toString();
}

export function parseClaimCreatePayload(value: unknown) {
  const payload = record(value);
  return {
    statement: boundedString(payload.statement, "Statement", 1000),
    evidence: boundedString(payload.evidence, "Evidence", 4000),
  };
}

type ClaimMutationPayload =
  | { id: string; action: "approve" | "reject" | "retire"; expectedVersion: number }
  | { id: string; action: "edit"; expectedVersion: number; statement: string; evidence: string };

export function parseClaimMutationPayload(value: unknown): ClaimMutationPayload {
  const payload = record(value);
  const action = payload.action;
  if (action !== "edit" && action !== "approve" && action !== "reject" && action !== "retire") {
    throw new PayloadValidationError("A valid claim action is required");
  }
  const common = {
    id: id(payload.id, "Claim id"),
    expectedVersion: expectedVersion(payload.expectedVersion),
  };
  if (action === "approve" || action === "reject" || action === "retire") return { ...common, action };
  return {
    ...common,
    action: "edit",
    statement: boundedString(payload.statement, "Statement", 1000),
    evidence: boundedString(payload.evidence, "Evidence", 4000),
  };
}

export function parseOutreachCreatePayload(value: unknown) {
  const payload = record(value);
  if (!Array.isArray(payload.claimIds) || payload.claimIds.length < 1 || payload.claimIds.length > 10) {
    throw new PayloadValidationError("claimIds must be an array of 1-10 ids");
  }
  const claimIds = payload.claimIds.map((claimId, index) => id(claimId, `Claim id ${index + 1}`));
  if (new Set(claimIds).size !== claimIds.length) throw new PayloadValidationError("Claim ids must be unique");
  return {
    jobId: id(payload.jobId, "Job id"),
    contactId: id(payload.contactId, "Contact id"),
    claimIds: claimIds.sort(),
    candidateName: boundedString(payload.candidateName, "Candidate name", CANDIDATE_NAME_MAX, true),
  };
}

export function parseOutreachMutationPayload(value: unknown) {
  const payload = record(value);
  if (payload.action !== "approve" && payload.action !== "reject") {
    throw new PayloadValidationError("Draft action must be approve or reject");
  }
  return {
    id: id(payload.id, "Draft id"),
    action: payload.action,
    revisionId: id(payload.revisionId, "Revision id"),
  };
}

export function parseJobMutationPayload(value: unknown) {
  const payload = record(value);
  if (payload.state !== "shortlisted" && payload.state !== "saved" && payload.state !== "rejected") {
    throw new PayloadValidationError("A valid job review state is required");
  }
  return { id: id(payload.id, "Job id"), state: payload.state };
}

export function parseContactExtractionPayload(value: unknown) {
  const payload = record(value);
  return { jobId: id(payload.jobId, "Job id") };
}

export function parseContactReviewPayload(value: unknown) {
  const payload = record(value);
  if (payload.reviewState !== "needs_review" && payload.reviewState !== "accepted" && payload.reviewState !== "rejected") {
    throw new PayloadValidationError("A valid contact evidence review state is required");
  }
  return { id: id(payload.id, "Contact id"), reviewState: payload.reviewState };
}

export function parseSyncPayload(value: unknown) {
  const payload = record(value);
  const sourceId = id(payload.sourceId, "Source id");
  const idempotencyKey = boundedString(payload.idempotencyKey, "Idempotency key", 128, true);
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(sourceId)) throw new PayloadValidationError("A valid source id is required");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(idempotencyKey)) {
    throw new PayloadValidationError("A valid idempotency key is required");
  }
  return { sourceId, idempotencyKey };
}

export function parseProfileUpsertPayload(value: unknown) {
  const payload = record(value);
  const kind = boundedString(payload.kind, "Profile field", PROFILE_KEY_MAX, true);
  if (!ALLOWED_PROFILE_KEYS.has(kind)) throw new PayloadValidationError("Unsupported profile field");
  const claim = kind === "writing_sample"
    ? boundedMultilineString(payload.claim, "Profile value", 6000)
    : boundedString(payload.claim, "Profile value", PROFILE_VALUE_MAX);
  return {
    kind,
    claim,
    evidence: boundedString(payload.evidence, "Profile evidence", PROFILE_EVIDENCE_MAX),
  };
}

export function parseProfileReviewPayload(value: unknown) {
  const payload = record(value);
  if (payload.action !== "verify" && payload.action !== "unverify") {
    throw new PayloadValidationError("Profile action must be verify or unverify");
  }
  return { id: id(payload.id, "Profile field id"), action: payload.action as "verify" | "unverify" };
}

export function parseApplicationPreparePayload(value: unknown) {
  const payload = record(value);
  return { jobId: id(payload.jobId, "Job id") };
}

export function parseApplicationProgressMutationPayload(value: unknown) {
  const payload = record(value);
  if (payload.action !== "mark_external_submission" && payload.action !== "clear_external_submission") {
    throw new PayloadValidationError("A valid application progress action is required");
  }
  const common = {
    applicationId: id(payload.applicationId, "Application id"),
    expectedArtifactVersion: expectedVersion(payload.expectedArtifactVersion),
  };
  if (payload.action === "clear_external_submission") return { ...common, action: payload.action } as const;
  return {
    ...common,
    action: payload.action,
    confirmationUrl: optionalHttpsUrl(payload.confirmationUrl, "Confirmation URL"),
  } as const;
}

export function parseInternshipIntakePayload(value: unknown) {
  const payload = record(value);
  const url = boundedString(payload.url, "Internship URL", 2000, true);
  const company = boundedString(payload.company, "Company", 160, true);
  const title = boundedString(payload.title, "Role title", 240, true);
  return { url, company, title };
}
