export const ROLE_TIMELINE_CAPABILITIES = Object.freeze({
  immutableEvidenceEvents: true,
  explicitApplicationEvents: true,
  publicContactEvidenceEvents: true,
  outreachDraftEvents: true,
  explicitOutcomeEvents: true,
  inferRecruiterMessages: false,
  readGmailThreads: false,
  inferEmailDelivery: false,
  send: false,
  submit: false,
} as const);

export type RoleTimelineEventKind =
  | "official_evidence"
  | "application_prepared"
  | "contact_evidence"
  | "outreach_drafted"
  | "outreach_reviewed"
  | "application_submitted"
  | "outcome_recorded";

export type RoleTimelineEvent = {
  id: string;
  kind: RoleTimelineEventKind;
  occurredAt: string | null;
  label: string;
  detail: string;
  evidence: "official" | "scout_record" | "explicit_user_record";
};

type TimelineJob = { id: string; currentSnapshotId?: string | null; lastSeenAt?: string | null; postedAt?: string | null };
type TimelineApplication = { id: string; status: string; createdAt?: string | null; updatedAt?: string | null; submittedAt: string | null };
type TimelineContact = { id: string; email: string; sourceUrl: string; reviewState: string; extractedAt?: string | null };
type TimelineRevision = { id: string; version: number; createdAt?: string | null };
type TimelineDraft = { id: string; state: string; approvedAt?: string | null; rejectedAt?: string | null; updatedAt?: string | null; revisions?: TimelineRevision[] };

function validTime(value: string | null | undefined) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

const order: Record<RoleTimelineEventKind, number> = {
  official_evidence: 0,
  application_prepared: 1,
  contact_evidence: 2,
  outreach_drafted: 3,
  outreach_reviewed: 4,
  application_submitted: 5,
  outcome_recorded: 6,
};

export function buildRoleTimeline(input: {
  job: TimelineJob;
  application?: TimelineApplication | null;
  contacts?: readonly TimelineContact[];
  drafts?: readonly TimelineDraft[];
}): RoleTimelineEvent[] {
  const events: RoleTimelineEvent[] = [];
  if (input.job.currentSnapshotId) events.push({
    id: `snapshot:${input.job.currentSnapshotId}`,
    kind: "official_evidence",
    occurredAt: validTime(input.job.lastSeenAt ?? input.job.postedAt),
    label: "Official role evidence captured",
    detail: "Scout is using the current immutable official job snapshot for this role.",
    evidence: "official",
  });

  const application = input.application;
  if (application) {
    events.push({
      id: `application:${application.id}:prepared`,
      kind: "application_prepared",
      occurredAt: validTime(application.createdAt),
      label: "Application review packet prepared",
      detail: "Scout prepared a review artifact; this is not an employer-side submission.",
      evidence: "scout_record",
    });
    if (application.submittedAt) events.push({
      id: `application:${application.id}:submitted`,
      kind: "application_submitted",
      occurredAt: validTime(application.submittedAt),
      label: "External application submission recorded",
      detail: "You explicitly recorded that the employer-side submission was completed outside Scout.",
      evidence: "explicit_user_record",
    });
    if (application.submittedAt && !["prepared", "ready", "awaiting_reply"].includes(application.status)) events.push({
      id: `application:${application.id}:outcome:${application.status}`,
      kind: "outcome_recorded",
      occurredAt: validTime(application.updatedAt ?? application.submittedAt),
      label: `Outcome recorded: ${application.status.replace(/_/g, " ")}`,
      detail: "This outcome is an explicit Scout record; no recruiter behavior was inferred from email or silence.",
      evidence: "explicit_user_record",
    });
  }

  for (const contact of input.contacts ?? []) events.push({
    id: `contact:${contact.id}`,
    kind: "contact_evidence",
    occurredAt: validTime(contact.extractedAt),
    label: `Public contact evidence ${contact.reviewState === "accepted" ? "accepted" : "captured"}`,
    detail: `${contact.email} · provenance: ${contact.sourceUrl}`,
    evidence: "official",
  });

  for (const draft of input.drafts ?? []) {
    for (const revision of draft.revisions ?? []) events.push({
      id: `draft:${draft.id}:revision:${revision.id}`,
      kind: "outreach_drafted",
      occurredAt: validTime(revision.createdAt),
      label: `Outreach draft v${revision.version} prepared`,
      detail: "Draft only. Scout does not treat draft creation as sending.",
      evidence: "scout_record",
    });
    if (draft.approvedAt || draft.rejectedAt) events.push({
      id: `draft:${draft.id}:review`,
      kind: "outreach_reviewed",
      occurredAt: validTime(draft.approvedAt ?? draft.rejectedAt ?? draft.updatedAt),
      label: draft.approvedAt ? "Exact outreach revision approved" : "Outreach draft rejected",
      detail: draft.approvedAt ? "Approval may permit draft creation where configured; it is not evidence that an email was sent." : "Rejected outreach stays non-sendable.",
      evidence: "explicit_user_record",
    });
  }

  return events.sort((left, right) => {
    const l = left.occurredAt ? Date.parse(left.occurredAt) : Number.POSITIVE_INFINITY;
    const r = right.occurredAt ? Date.parse(right.occurredAt) : Number.POSITIVE_INFINITY;
    if (l !== r) return l - r;
    return order[left.kind] - order[right.kind] || left.id.localeCompare(right.id);
  });
}
