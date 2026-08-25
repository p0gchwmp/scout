import { explicitDeadlineSignal } from "./application-progress.ts";

export const FOLLOW_UP_CAPABILITIES = Object.freeze({
  explicitDeadlineParsing: true,
  roleFreshness: true,
  submissionWaitingAge: true,
  inferRecruiterResponse: false,
  inferDeadline: false,
  scheduleFollowUp: false,
  sendFollowUp: false,
} as const);

export type FollowUpBucket = "today" | "soon" | "waiting" | "done";

export type FollowUpJob = {
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  description: string;
  postedAt: string | null;
  lastSeenAt: string;
};

export type FollowUpApplication = {
  status: string;
  submittedAt: string | null;
} | null;

export type FollowUpContact = {
  reviewState: "needs_review" | "accepted" | "rejected";
};

export type FollowUpDraft = {
  state: "draft" | "approved" | "rejected";
};

export type DeadlineAssessment = {
  raw: string;
  dateIso: string | null;
  daysRemaining: number | null;
  label: string;
};

const MONTHS = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9], ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11], ["dec", 12], ["december", 12],
]);

function validCalendarDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseNamedDate(text: string) {
  const monthFirst = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
  if (monthFirst) {
    const month = MONTHS.get(monthFirst[1].toLowerCase());
    if (month) return validCalendarDate(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }
  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})[,]?\s+(20\d{2})\b/i);
  if (dayFirst) {
    const month = MONTHS.get(dayFirst[2].toLowerCase());
    if (month) return validCalendarDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }
  return null;
}

export function parseExplicitDeadlineDate(signal: string) {
  const iso = signal.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return validCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const named = parseNamedDate(signal);
  if (named) return named;

  const numeric = signal.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (!numeric) return null;
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const year = Number(numeric[3]);
  if (first > 12 && second <= 12) return validCalendarDate(year, second, first);
  if (second > 12 && first <= 12) return validCalendarDate(year, first, second);
  return null;
}

function localCalendarEpoch(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysFromToday(dateIso: string, now: Date) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - localCalendarEpoch(now)) / 86_400_000);
}

export function assessExplicitDeadline(job: FollowUpJob, now = new Date()): DeadlineAssessment | null {
  if (!job.currentSnapshotId) return null;
  const raw = explicitDeadlineSignal(job.description);
  if (!raw) return null;
  const dateIso = parseExplicitDeadlineDate(raw);
  if (!dateIso) return { raw, dateIso: null, daysRemaining: null, label: "Explicit deadline found; date needs manual interpretation" };
  const daysRemaining = daysFromToday(dateIso, now);
  const label = daysRemaining < 0
    ? `Official deadline passed ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago`
    : daysRemaining === 0
      ? "Official deadline is today"
      : daysRemaining === 1
        ? "Official deadline is tomorrow"
        : `Official deadline in ${daysRemaining} days`;
  return { raw, dateIso, daysRemaining, label };
}

function ageInDays(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

export function roleFreshness(postedAt: string | null, lastSeenAt: string, now = new Date()) {
  const ageDays = ageInDays(postedAt, now);
  if (ageDays === null) return { ageDays: null, label: `Recently observed ${ageInDays(lastSeenAt, now) ?? "?"} day(s) ago; posting date unavailable` };
  if (ageDays <= 3) return { ageDays, label: "New posting" };
  if (ageDays <= 14) return { ageDays, label: "Recent posting" };
  if (ageDays <= 30) return { ageDays, label: "Posting is a few weeks old" };
  return { ageDays, label: `Posting is ${ageDays} days old` };
}

export function assessFollowUp(input: {
  job: FollowUpJob;
  application: FollowUpApplication;
  contacts: FollowUpContact[];
  drafts: FollowUpDraft[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const { job, application, contacts, drafts } = input;
  const deadline = assessExplicitDeadline(job, now);
  const freshness = roleFreshness(job.postedAt, job.lastSeenAt, now);
  const submitted = Boolean(application?.submittedAt);
  const waitingDays = submitted ? ageInDays(application?.submittedAt, now) : null;
  const pendingContactReview = contacts.some((contact) => contact.reviewState === "needs_review");
  const acceptedContact = contacts.some((contact) => contact.reviewState === "accepted");
  const pendingDraftReview = drafts.some((draft) => draft.state === "draft");
  const approvedDraft = drafts.some((draft) => draft.state === "approved");

  let bucket: FollowUpBucket;
  let reason: string;

  if (job.state === "rejected" || (job.lifecycleState === "closed" && !submitted)) {
    bucket = "done";
    reason = job.state === "rejected" ? "You rejected this role." : "The role is closed and no submission is recorded.";
  } else if (pendingContactReview) {
    bucket = "today";
    reason = "Published contact evidence is waiting for your review.";
  } else if (pendingDraftReview) {
    bucket = "today";
    reason = "A pinned outreach draft is waiting for your review.";
  } else if (!submitted && deadline?.daysRemaining !== null && deadline?.daysRemaining !== undefined && deadline.daysRemaining <= 2) {
    bucket = "today";
    reason = deadline.daysRemaining < 0 ? "The explicit official deadline has passed; verify the posting before spending more time." : deadline.label;
  } else if (submitted && approvedDraft) {
    bucket = "soon";
    reason = "Outreach is approved and waiting on your manual send decision.";
  } else if (submitted && acceptedContact && !drafts.length) {
    bucket = "soon";
    reason = "An accepted public contact is available if you want to prepare low-volume outreach.";
  } else if (submitted) {
    bucket = "waiting";
    reason = waitingDays === null
      ? "Submission is recorded. Scout has no evidence of a recruiter response yet."
      : `Submitted ${waitingDays} day${waitingDays === 1 ? "" : "s"} ago. Scout does not infer recruiter response or a follow-up deadline.`;
  } else {
    bucket = "soon";
    if (deadline?.daysRemaining !== null && deadline?.daysRemaining !== undefined && deadline.daysRemaining <= 7) reason = deadline.label;
    else if (application?.status === "ready_for_review") reason = "Application packet is ready for live-form review.";
    else reason = `${freshness.label}. Continue the evidence-backed application flow when you have time.`;
  }

  const deadlineSort = deadline?.daysRemaining ?? 9999;
  const freshnessSort = freshness.ageDays ?? 9999;
  const bucketRank: Record<FollowUpBucket, number> = { today: 0, soon: 1, waiting: 2, done: 3 };

  return {
    bucket,
    label: bucket === "today" ? "Today" : bucket === "soon" ? "Soon" : bucket === "waiting" ? "Waiting" : "Done",
    reason,
    deadline,
    freshness,
    waitingDays,
    sortKey: [bucketRank[bucket], deadlineSort, freshnessSort] as const,
    capabilities: FOLLOW_UP_CAPABILITIES,
  };
}
