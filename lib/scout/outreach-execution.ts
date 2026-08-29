export const OUTREACH_GMAIL_DRAFT_EXECUTION_CAPABILITIES = Object.freeze({
  createDraft: true,
  sendEmail: false,
  requireCurrentJobSnapshot: true,
  requireAcceptedContactEvidence: true,
  requireCurrentApprovedClaims: true,
  requirePinnedRecipientMatch: true,
  requireBodyHashMatch: true,
} as const);

export type JobOutreachExecutionContact = {
  id: string;
  jobId: string;
  jobSnapshotId: string;
  email: string;
  reviewState: string;
};

export type CompanyOutreachExecutionContact = {
  id: string;
  targetId: string;
  email: string;
  reviewState: string;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameEmail(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sameClaimSet(expected: readonly string[], currentUsable: readonly string[]) {
  if (!expected.length || expected.length !== currentUsable.length) return false;
  const expectedSet = new Set(expected);
  const currentSet = new Set(currentUsable);
  if (expectedSet.size !== expected.length || currentSet.size !== currentUsable.length) return false;
  return [...expectedSet].every((id) => currentSet.has(id));
}

export function parsePinnedOutreachClaimIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const ids = value.map((id) => cleanString(id));
  if (ids.some((id) => !id || id.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(id))) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

export function jobOutreachExecutionIssues(input: {
  jobId: string;
  currentJobSnapshotId: string | null | undefined;
  revisionJobSnapshotId: string;
  revisionContactId: string;
  revisionClaimIds: readonly string[];
  currentUsableClaimIds: readonly string[];
  contact: JobOutreachExecutionContact | null | undefined;
  parsedRecipient: string;
  expectedBodyHash: string;
  actualBodyHash: string;
}) {
  const issues: string[] = [];
  if (!input.currentJobSnapshotId || input.revisionJobSnapshotId !== input.currentJobSnapshotId) {
    issues.push("Approved outreach revision is pinned to an old job snapshot");
  }

  const contact = input.contact;
  if (!contact
    || contact.id !== input.revisionContactId
    || contact.jobId !== input.jobId
    || contact.jobSnapshotId !== input.revisionJobSnapshotId
    || contact.reviewState !== "accepted") {
    issues.push("Pinned contact evidence is missing, changed, or no longer accepted");
  } else if (!sameEmail(input.parsedRecipient, contact.email)) {
    issues.push("Approved outreach recipient no longer matches the accepted contact evidence");
  }

  if (!sameClaimSet(input.revisionClaimIds, input.currentUsableClaimIds)) {
    issues.push("One or more pinned candidate claims are missing or no longer reusable approved evidence");
  }

  if (!input.expectedBodyHash || input.expectedBodyHash !== input.actualBodyHash) {
    issues.push("Approved outreach revision body no longer matches its immutable hash");
  }

  return [...new Set(issues)];
}

export function companyOutreachExecutionIssues(input: {
  targetId: string;
  targetState: string | null | undefined;
  revisionTargetId: string;
  revisionContactId: string;
  revisionClaimIds: readonly string[];
  currentUsableClaimIds: readonly string[];
  contact: CompanyOutreachExecutionContact | null | undefined;
  parsedRecipient: string;
  expectedBodyHash: string;
  actualBodyHash: string;
}) {
  const issues: string[] = [];
  if (input.targetState !== "active" || input.revisionTargetId !== input.targetId) {
    issues.push("Company outreach target is missing, changed, or no longer active");
  }

  const contact = input.contact;
  if (!contact
    || contact.id !== input.revisionContactId
    || contact.targetId !== input.targetId
    || contact.reviewState !== "accepted") {
    issues.push("Pinned company contact evidence is missing, changed, or no longer accepted");
  } else if (!sameEmail(input.parsedRecipient, contact.email)) {
    issues.push("Approved company outreach recipient no longer matches the accepted contact evidence");
  }

  if (!sameClaimSet(input.revisionClaimIds, input.currentUsableClaimIds)) {
    issues.push("One or more pinned candidate claims are missing or no longer reusable approved evidence");
  }

  if (!input.expectedBodyHash || input.expectedBodyHash !== input.actualBodyHash) {
    issues.push("Approved company outreach revision body no longer matches its immutable hash");
  }

  return [...new Set(issues)];
}
