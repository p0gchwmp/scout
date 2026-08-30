export const OUTREACH_PROFILE_FRESHNESS_CAPABILITIES = Object.freeze({
  requireVerifiedFullName: true,
  rejectCallerIdentityOverride: true,
  recheckIdentityBeforeGmailDraft: true,
  staleOnUnverifyEditOrReverify: true,
  inferIdentity: false,
  sendEmail: false,
  submitApplication: false,
} as const);

export type OutreachProfileField = {
  id: string;
  kind: string;
  claim: string;
  verified: boolean;
  updatedAt?: string | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parsedTime(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : null;
}

export function currentVerifiedOutreachIdentity(fields: readonly OutreachProfileField[]) {
  const verified = fields.filter((field) => field.kind === "full_name" && field.verified && clean(field.claim));
  if (verified.length !== 1) return null;
  const field = verified[0];
  const updatedAtMs = parsedTime(field.updatedAt);
  if (updatedAtMs === null) return null;
  return {
    id: clean(field.id),
    fullName: clean(field.claim),
    updatedAt: clean(field.updatedAt),
    updatedAtMs,
  };
}

export function verifiedOutreachCandidateName(
  fields: readonly OutreachProfileField[],
  callerCandidateName?: string | null,
) {
  const identity = currentVerifiedOutreachIdentity(fields);
  if (!identity) throw new Error("Exactly one current verified full_name profile field is required for outreach");
  const requested = clean(callerCandidateName);
  if (requested && requested !== identity.fullName) {
    throw new Error("Outreach candidate name must match the current verified full_name profile evidence");
  }
  return identity.fullName;
}

export function outreachIdentityExecutionIssues(input: {
  revisionCreatedAt: string;
  currentProfileFields: readonly OutreachProfileField[];
}) {
  const identity = currentVerifiedOutreachIdentity(input.currentProfileFields);
  if (!identity) return ["Current verified full_name profile evidence is missing or ambiguous"];
  const revisionCreatedAtMs = parsedTime(input.revisionCreatedAt);
  if (revisionCreatedAtMs === null) return ["Outreach revision creation time is invalid"];
  if (identity.updatedAtMs > revisionCreatedAtMs) {
    return ["Verified full_name profile evidence changed after this outreach revision was created"];
  }
  return [];
}
