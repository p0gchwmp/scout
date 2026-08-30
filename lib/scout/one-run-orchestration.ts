export const ONE_RUN_ORCHESTRATION_CAPABILITIES = Object.freeze({
  reuseCoreScoutRun: true,
  ecosystemSearchEphemeral: true,
  seedCuratedOfficialRecruitingTargets: true,
  researchPublicBusinessContacts: true,
  newContactsNeedReview: true,
  summarizeExplicitOutcomes: true,
  surfaceAcceptedContactsReadyForDrafting: true,
  autoPromotePortfolioLead: false,
  autoAcceptContact: false,
  createGmailDraft: false,
  sendEmail: false,
  submitApplication: false,
} as const);

export type OutcomeSummaryRow = {
  status: string;
  submittedAt: string | null;
  approvedAt?: string | null;
};

const TERMINAL = new Set(["rejected", "offer", "withdrawn"]);
const ACTIVE_RESPONSE = new Set(["recruiter_replied", "interview"]);

function validTime(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeOutcomeQueue(rows: readonly OutcomeSummaryRow[], now = new Date()) {
  let awaitingReply = 0;
  let activeResponses = 0;
  let terminal = 0;
  let followUpsDue = 0;
  let submittedWithoutOutcome = 0;

  for (const row of rows) {
    if (!row.submittedAt) continue;
    if (TERMINAL.has(row.status)) terminal += 1;
    else if (ACTIVE_RESPONSE.has(row.status)) activeResponses += 1;
    else if (row.status === "awaiting_reply") awaitingReply += 1;
    else submittedWithoutOutcome += 1;

    const followUpAt = validTime(row.approvedAt);
    if (followUpAt !== null && followUpAt <= now.getTime() && !TERMINAL.has(row.status)) followUpsDue += 1;
  }

  return {
    submitted: rows.filter((row) => Boolean(row.submittedAt)).length,
    awaitingReply,
    activeResponses,
    terminal,
    submittedWithoutOutcome,
    followUpsDue,
  };
}

export function dedupeEphemeralLeads<T extends { url: string }>(leads: readonly T[], limit = 60) {
  return [...new Map(leads.map((lead) => [lead.url, lead])).values()].slice(0, Math.max(0, limit));
}
