export const APPLICATION_PROGRESS_CAPABILITIES = Object.freeze({
  deriveProgress: true,
  recordExternalSubmission: true,
  submitApplication: false,
  inferSubmission: false,
  inferDeadline: false,
  inferFormReview: false,
} as const);

export type ProgressJob = {
  id: string;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  description: string;
  canonicalUrl: string;
};

export type ProgressApplication = {
  id: string;
  status: string;
  blockers: string[];
  artifactVersion: number;
  submittedAt: string | null;
  confirmationUrl: string | null;
} | null;

export type ProgressContact = { reviewState: "needs_review" | "accepted" | "rejected" };
export type ProgressDraft = { state: "draft" | "approved" | "rejected" };

export type ProgressStageId =
  | "discovered"
  | "reviewed"
  | "official_evidence"
  | "packet"
  | "safe_fill"
  | "external_submission"
  | "contact"
  | "outreach";

export type ProgressStage = {
  id: ProgressStageId;
  label: string;
  state: "done" | "current" | "upcoming" | "blocked";
  detail: string;
};

export type ProgressAction = {
  label: string;
  href: string;
  kind: "navigate" | "external_submission_record" | "none";
};

const DEADLINE_PATTERN = /\b(?:application\s+deadline|applications?\s+(?:close|closing)|apply\s+by|deadline)\b[^\n.!?]{0,80}/ig;

export function explicitDeadlineSignal(description: string) {
  const text = description.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const matches = [...text.matchAll(DEADLINE_PATTERN)];
  if (!matches.length) return null;
  const raw = matches[0][0].replace(/\s+/g, " ").trim();
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

function stage(id: ProgressStageId, label: string, done: boolean, detail: string): ProgressStage {
  return { id, label, state: done ? "done" : "upcoming", detail };
}

export function buildApplicationProgress(input: {
  job: ProgressJob;
  application: ProgressApplication;
  contacts: ProgressContact[];
  drafts: ProgressDraft[];
}) {
  const { job, application, contacts, drafts } = input;
  const hasInterest = job.state === "shortlisted" || job.state === "saved";
  const hasSnapshot = Boolean(job.currentSnapshotId);
  const hasPacket = Boolean(application);
  const readyForReview = application?.status === "ready_for_review";
  const externallySubmitted = Boolean(application?.submittedAt);
  const hasContactEvidence = contacts.length > 0;
  const hasAcceptedContact = contacts.some((contact) => contact.reviewState === "accepted");
  const hasDraft = drafts.length > 0;
  const hasApprovedDraft = drafts.some((draft) => draft.state === "approved");

  const stages: ProgressStage[] = [
    stage("discovered", "Discovered", true, "Scout has a job record for this role."),
    stage("reviewed", "Reviewed", hasInterest, hasInterest ? "Role is saved or shortlisted." : "Review the role before investing application time."),
    stage("official_evidence", "Official evidence", hasSnapshot, hasSnapshot ? "Immutable official job evidence is captured." : "Resolve the lead to an official source first."),
    stage("packet", "Application packet", hasPacket, hasPacket ? `Packet v${application!.artifactVersion} · ${application!.status.replace(/_/g, " ")}.` : "No application packet prepared yet."),
    stage("safe_fill", "Safe Fill ready", Boolean(readyForReview), readyForReview ? "The packet can create an exact-page Safe Fill handoff. Form inspection and answer review still happen with you present." : "Readiness blockers must be cleared before browser assistance unlocks."),
    stage("external_submission", "Submitted externally", externallySubmitted, externallySubmitted ? `You recorded submission at ${application!.submittedAt}. Scout did not submit it.` : "After you submit on the employer site, record that fact here."),
    stage("contact", "Contact research", hasContactEvidence, hasAcceptedContact ? "At least one public business/recruiting contact is accepted." : hasContactEvidence ? "Contact evidence exists and still needs review." : "No public contact evidence researched yet."),
    stage("outreach", "Outreach", hasDraft, hasApprovedDraft ? "An outreach draft is approved for your manual send decision." : hasDraft ? "A pinned outreach draft exists for review." : "No outreach draft created yet."),
  ];

  let nextAction: ProgressAction;
  let summary: string;

  if (job.state === "rejected") {
    summary = "Rejected role — no next action is recommended.";
    nextAction = { label: "No action", href: "#", kind: "none" };
  } else if (job.lifecycleState === "closed" && !externallySubmitted) {
    summary = "The role is closed and no external submission is recorded.";
    nextAction = { label: "Review role history", href: job.canonicalUrl, kind: "navigate" };
  } else if (!hasInterest) {
    summary = "Review this role and decide whether it deserves application time.";
    nextAction = { label: "Open Shortlist", href: "/shortlist", kind: "navigate" };
  } else if (!hasSnapshot) {
    summary = "Official evidence is still missing.";
    nextAction = { label: "Open Internship Inbox", href: "/inbox", kind: "navigate" };
  } else if (!hasPacket || application?.status === "needs_input") {
    summary = application?.blockers.length ? `Application needs ${application.blockers.length} input(s) before Safe Fill.` : "Prepare the application packet and clear readiness blockers.";
    nextAction = { label: "Open Readiness", href: "/readiness", kind: "navigate" };
  } else if (!externallySubmitted) {
    summary = "The packet is ready. Inspect the live form, review any drafted answers, submit it yourself, then record that submission.";
    nextAction = { label: "Open Safe Fill", href: "/assist", kind: "navigate" };
  } else if (!hasContactEvidence) {
    summary = "Application submission is recorded. Contact research is the next optional follow-up step.";
    nextAction = { label: "Research contact", href: "/shortlist", kind: "navigate" };
  } else if (!hasAcceptedContact) {
    summary = "Public contact evidence exists but still needs your review.";
    nextAction = { label: "Review contact evidence", href: "/review", kind: "navigate" };
  } else if (!hasDraft) {
    summary = "An accepted public contact is available; you can prepare a low-volume outreach draft.";
    nextAction = { label: "Create outreach draft", href: "/review", kind: "navigate" };
  } else {
    summary = hasApprovedDraft
      ? "Application and outreach preparation are recorded. Any send remains your decision."
      : "An outreach draft exists and is waiting for review.";
    nextAction = { label: "Review outreach", href: "/review", kind: "navigate" };
  }

  const firstIncomplete = stages.find((item) => item.state !== "done");
  if (firstIncomplete && job.state !== "rejected") firstIncomplete.state = application?.status === "needs_input" && firstIncomplete.id === "safe_fill" ? "blocked" : "current";

  return {
    summary,
    nextAction,
    stages,
    deadlineSignal: explicitDeadlineSignal(job.description),
    externallySubmitted,
    confirmationUrl: application?.confirmationUrl ?? null,
    applicationId: application?.id ?? null,
    artifactVersion: application?.artifactVersion ?? null,
    capabilities: APPLICATION_PROGRESS_CAPABILITIES,
  };
}
