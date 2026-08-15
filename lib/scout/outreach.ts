export const OUTREACH_CAPABILITIES = Object.freeze({ draft: true, send: false, apply: false } as const);
export const OUTREACH_TEMPLATE_VERSION = 1;

export async function hashDraftBody(body: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export type DraftRenderInput = {
  candidateName: string;
  companyName: string;
  roleTitle: string;
  contactEmail: string;
  jobSnapshotId: string;
  contactId: string;
  claims: Array<{ id: string; statement: string }>;
};

export type RenderedDraft = {
  body: string;
  jobSnapshotId: string;
  contactId: string;
  claimIds: string[];
};

export type DraftRevision = RenderedDraft & {
  id: string;
  version: number;
  createdAt: string;
};

export type OutreachDraft = {
  id: string;
  state: "draft" | "approved" | "rejected";
  revisions: DraftRevision[];
  approvedRevisionId?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
};

function cleanSingleLine(value: string, field: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || /[\r\n]/.test(value)) throw new Error(`${field} must be a non-empty single line`);
  return cleaned;
}

export function renderOutreachDraft(input: DraftRenderInput): RenderedDraft {
  const candidateName = cleanSingleLine(input.candidateName, "Candidate name");
  const companyName = cleanSingleLine(input.companyName, "Company name");
  const roleTitle = cleanSingleLine(input.roleTitle, "Role title");
  const contactEmail = cleanSingleLine(input.contactEmail, "Contact email").toLowerCase();
  const claims = [...input.claims]
    .map((claim) => ({ id: claim.id, statement: cleanSingleLine(claim.statement, "Claim") }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!claims.length) throw new Error("At least one approved claim is required");

  const evidence = claims.map((claim) => `- ${claim.statement}`).join("\n");
  const body = [
    `To: ${contactEmail}`,
    `Subject: Interest in ${roleTitle} at ${companyName}`,
    "",
    "Hello recruiting team,",
    "",
    `I am writing to express interest in the ${roleTitle} role at ${companyName}.`,
    "Relevant, approved facts from my background:",
    evidence,
    "",
    "If helpful, I would be glad to share more context. This is a draft for review and has not been sent.",
    "",
    `Best,`,
    candidateName,
  ].join("\n");

  return {
    body,
    jobSnapshotId: input.jobSnapshotId,
    contactId: input.contactId,
    claimIds: claims.map((claim) => claim.id),
  };
}

export function approveDraft(draft: OutreachDraft, revisionId: string, approvedAt: string): OutreachDraft {
  if (draft.state !== "draft") throw new Error("Only a draft can be approved");
  const latest = draft.revisions.at(-1);
  if (!latest) throw new Error("Draft has no revision to approve");
  if (latest.id !== revisionId) throw new Error("Approval must bind the latest revision");
  return { ...draft, state: "approved", approvedRevisionId: revisionId, approvedAt };
}

export function rejectDraft(draft: OutreachDraft, rejectedAt: string): OutreachDraft {
  if (draft.state !== "draft") throw new Error("Only a draft can be rejected");
  return { ...draft, state: "rejected", rejectedAt };
}
