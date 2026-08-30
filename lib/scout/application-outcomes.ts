export const APPLICATION_OUTCOME_CAPABILITIES = Object.freeze({
  recordManualOutcome: true,
  recordExplicitFollowUpDate: true,
  suggestNextStep: true,
  inferRecruiterResponse: false,
  inferFollowUpDate: false,
  readGmailThreads: false,
  sendFollowUp: false,
  submitApplication: false,
} as const);

export const APPLICATION_OUTCOME_STATES = Object.freeze([
  "awaiting_reply",
  "recruiter_replied",
  "interview",
  "rejected",
  "offer",
  "withdrawn",
] as const);

export type ApplicationOutcomeState = (typeof APPLICATION_OUTCOME_STATES)[number];

export type OutcomeApplication = {
  status: string;
  submittedAt: string | null;
  approvedAt?: string | null;
};

export function isApplicationOutcomeState(value: unknown): value is ApplicationOutcomeState {
  return typeof value === "string" && (APPLICATION_OUTCOME_STATES as readonly string[]).includes(value);
}

export function normalizeFollowUpAt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 64) throw new Error("A valid ISO follow-up date is required");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("A valid ISO follow-up date is required");
  return new Date(ms).toISOString();
}

export function validateOutcomeTransition(application: OutcomeApplication, next: ApplicationOutcomeState) {
  if (!application.submittedAt) {
    throw new Error("Record the external application submission before recording a recruiter outcome");
  }
  if (application.status === "rejected" || application.status === "offer" || application.status === "withdrawn") {
    if (application.status !== next) throw new Error("A terminal application outcome cannot be changed without clearing it first");
  }
  return next;
}

export function outcomeGuidance(application: OutcomeApplication, now = new Date()) {
  const status = isApplicationOutcomeState(application.status)
    ? application.status
    : application.submittedAt
      ? "awaiting_reply"
      : null;
  const followUpAt = application.approvedAt ? normalizeFollowUpAt(application.approvedAt) : null;
  const followUpDue = followUpAt ? Date.parse(followUpAt) <= now.getTime() : false;

  if (!application.submittedAt) return {
    state: null,
    label: "Not submitted",
    guidance: "Complete the employer-side submission yourself before tracking recruiter outcomes.",
    followUpAt,
    followUpDue: false,
  };

  const guidance: Record<ApplicationOutcomeState, string> = {
    awaiting_reply: followUpDue
      ? "Your explicit follow-up date has arrived. Review the role/contact evidence and prepare a follow-up draft if you still want to reach out."
      : followUpAt
        ? "Waiting for a response. Scout will surface the follow-up when the date you chose arrives."
        : "Waiting for a response. Set a follow-up date only if you want one; Scout will not invent a cadence.",
    recruiter_replied: "Review the recruiter response yourself and record the next concrete stage.",
    interview: "Prepare for the interview using the official role snapshot and your approved claims; keep scheduling/manual replies under your control.",
    rejected: "Closed as rejected. No follow-up is recommended unless you deliberately reopen the opportunity.",
    offer: "Offer recorded. Review terms and decisions manually; Scout does not accept offers or make commitments.",
    withdrawn: "You withdrew this application. No further action is recommended.",
  };
  return {
    state: status,
    label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    guidance: guidance[status],
    followUpAt,
    followUpDue,
  };
}
