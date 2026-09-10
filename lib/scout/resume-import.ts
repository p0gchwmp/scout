export const RESUME_IMPORT_PROFILE_KINDS = Object.freeze([
  "full_name",
  "email",
  "phone",
  "current_location",
  "university",
  "program",
  "graduation_year",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "resume_reference",
] as const);

export type ResumeImportProfileKind = (typeof RESUME_IMPORT_PROFILE_KINDS)[number];

export type ResumeImportProfileField = {
  kind: ResumeImportProfileKind;
  claim: string;
  evidence: string;
};

export type ResumeImportClaim = {
  statement: string;
  evidence: string;
};

export type ResumeImportPayload = {
  schemaVersion: 1;
  resumeReference: string;
  acknowledgeDraftOnly: true;
  profile: ResumeImportProfileField[];
  claims: ResumeImportClaim[];
};

function object(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function cleanLine(value: unknown, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max || /[\r\n\0]/.test(value)) throw new Error(`${field} is invalid`);
  return cleaned;
}

function cleanEvidence(value: unknown, field: string, fallback: string) {
  if (value === undefined || value === null || value === "") return fallback;
  return cleanLine(value, field, 1200);
}

function isProfileKind(value: string): value is ResumeImportProfileKind {
  return (RESUME_IMPORT_PROFILE_KINDS as readonly string[]).includes(value);
}

export function parseResumeImportPayload(value: unknown): ResumeImportPayload {
  const raw = object(value, "Resume import");
  const allowed = new Set(["schemaVersion", "resumeReference", "acknowledgeDraftOnly", "profile", "claims"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("Unexpected resume import field");
  if (raw.schemaVersion !== 1) throw new Error("Resume import schemaVersion must be 1");
  if (raw.acknowledgeDraftOnly !== true) {
    throw new Error("Resume import must acknowledge that profile facts remain unverified and claims remain draft until reviewed");
  }

  const resumeReference = cleanLine(raw.resumeReference, "Resume reference", 240);
  if (!Array.isArray(raw.profile) || raw.profile.length > RESUME_IMPORT_PROFILE_KINDS.length) {
    throw new Error(`Resume import profile must contain 0-${RESUME_IMPORT_PROFILE_KINDS.length} fields`);
  }
  if (!Array.isArray(raw.claims) || raw.claims.length < 1 || raw.claims.length > 30) {
    throw new Error("Resume import claims must contain 1-30 draft claims");
  }

  const defaultEvidence = `User-approved resume: ${resumeReference}`;
  const profile = raw.profile.map((entry, index) => {
    const field = object(entry, `Profile field ${index + 1}`);
    if (Object.keys(field).some((key) => key !== "kind" && key !== "claim" && key !== "evidence")) {
      throw new Error(`Unexpected profile field ${index + 1} property`);
    }
    const kind = cleanLine(field.kind, `Profile field ${index + 1} kind`, 80);
    if (!isProfileKind(kind)) throw new Error(`Profile field ${index + 1} kind is not supported`);
    return {
      kind,
      claim: cleanLine(field.claim, `Profile field ${index + 1} claim`, 1200),
      evidence: cleanEvidence(field.evidence, `Profile field ${index + 1} evidence`, defaultEvidence),
    };
  });
  if (new Set(profile.map((field) => field.kind)).size !== profile.length) {
    throw new Error("Resume import profile kinds must be unique");
  }

  const claims = raw.claims.map((entry, index) => {
    const claim = object(entry, `Resume claim ${index + 1}`);
    if (Object.keys(claim).some((key) => key !== "statement" && key !== "evidence")) {
      throw new Error(`Unexpected resume claim ${index + 1} property`);
    }
    return {
      statement: cleanLine(claim.statement, `Resume claim ${index + 1} statement`, 1200),
      evidence: cleanEvidence(claim.evidence, `Resume claim ${index + 1} evidence`, defaultEvidence),
    };
  });
  const claimKeys = claims.map((claim) => `${claim.statement.toLowerCase()}\n${claim.evidence.toLowerCase()}`);
  if (new Set(claimKeys).size !== claimKeys.length) throw new Error("Resume import contains duplicate claims");

  return { schemaVersion: 1, resumeReference, acknowledgeDraftOnly: true, profile, claims };
}
