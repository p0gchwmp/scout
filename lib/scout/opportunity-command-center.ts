export const OPPORTUNITY_COMMAND_CENTER_CAPABILITIES = Object.freeze({
  unifiedHumanReviewQueue: true,
  persistedJobsRemainEvidenceBound: true,
  ecosystemSearchResultsRemainEphemeral: true,
  portfolioBoardsRemainLeadOnly: true,
  unregisteredEcosystemSourcesRemainReviewOnly: true,
  researchPublicRecruitingContacts: true,
  seedRecruitingTargetsByExplicitOwnerAction: true,
  createGmailDraftAfterExactApproval: true,
  sendEmail: false,
  submitApplication: false,
  autoAcceptContact: false,
  autoRegisterSource: false,
  autoRejectOpportunity: false,
  mutateResumeClaims: false,
} as const);

export type CommandPriority = "A" | "B" | "C" | "parked";

export type CommandActionKind =
  | "review_quality"
  | "capture_evidence"
  | "prepare_application"
  | "resolve_application_input"
  | "review_application"
  | "review_contact"
  | "draft_outreach"
  | "review_outreach"
  | "gmail_draft_review"
  | "resolve_portfolio_employer"
  | "review_register_source"
  | "capture_direct_ecosystem_role";

export type CommandAction = {
  kind: CommandActionKind;
  label: string;
  href: string;
  reason: string;
  urgency: number;
  external: boolean;
};

export type CommandJobInput = {
  id: string;
  company: string;
  title: string;
  state: string;
  lifecycleState: string;
  currentSnapshotId: string | null;
  canonicalUrl: string;
  priority: CommandPriority;
  priorityLabel: string;
  qualityLabel: string;
  applicationStatus?: string | null;
  contactStates?: string[];
  draftStates?: string[];
};

export type CommandJobItem = CommandJobInput & {
  nextAction: CommandAction;
  stage: "evidence" | "application" | "contact" | "outreach" | "parked";
};

export type CommandEcosystemLead = {
  sourceId: string | null;
  sourceName: string;
  sourceMode: "direct_institution" | "portfolio_board" | "ecosystem_index_lead";
  title: string;
  url: string;
  description: string;
  lane: string | null;
  requiresOfficialSourceRegistration: boolean;
  requiresOfficialEmployerResolution: boolean;
};

function action(
  kind: CommandActionKind,
  label: string,
  href: string,
  reason: string,
  urgency: number,
  external = false,
): CommandAction {
  return { kind, label, href, reason, urgency, external };
}

export function recommendJobNextAction(input: CommandJobInput): CommandAction {
  if (input.priority === "parked") {
    return action(
      "review_quality",
      "Review why this is parked",
      "/quality",
      "Parked is a human-review bucket, not an automatic rejection.",
      95,
    );
  }

  if (!input.currentSnapshotId) {
    return action(
      "capture_evidence",
      "Resolve official evidence",
      "/evidence",
      "Scout should not prepare an application or outreach from a lead without a current immutable job snapshot.",
      100,
    );
  }

  if (input.applicationStatus === "needs_input") {
    return action(
      "resolve_application_input",
      "Resolve application blockers",
      "/readiness",
      "The current application packet exists but still needs verified profile data, claim evidence, or portal resolution.",
      92,
    );
  }

  if (input.applicationStatus === "ready_for_review") {
    return action(
      "review_application",
      "Review application packet",
      "/readiness",
      "A snapshot-pinned packet is ready for human review before any browser assistance.",
      90,
    );
  }

  if (!input.applicationStatus) {
    return action(
      "prepare_application",
      "Prepare application packet",
      "/applications",
      "Official evidence exists; the next safe step is a versioned application review packet, not submission.",
      88,
    );
  }

  const contactStates = new Set(input.contactStates ?? []);
  const draftStates = new Set(input.draftStates ?? []);

  if (contactStates.has("needs_review")) {
    return action(
      "review_contact",
      "Review public contact evidence",
      "/contacts",
      "A published business/recruiting contact was captured but remains unusable until human acceptance.",
      70,
    );
  }

  if (draftStates.has("draft")) {
    return action(
      "review_outreach",
      "Review outreach draft",
      "/review",
      "A claim-backed draft exists and must be approved as an exact revision before Gmail drafting.",
      68,
    );
  }

  if (draftStates.has("approved")) {
    return action(
      "gmail_draft_review",
      "Create reviewed Gmail draft",
      "/review",
      "The exact outreach revision is approved; Scout may now create a Gmail draft after the M11/M12 freshness checks pass. Sending remains manual.",
      66,
    );
  }

  if (contactStates.has("accepted")) {
    return action(
      "draft_outreach",
      "Draft optional outreach",
      "/review",
      "Accepted public contact evidence exists. Outreach remains optional and review-bound.",
      60,
    );
  }

  return action(
    "review_contact",
    "Consider public contact research",
    "/contacts",
    "Application preparation is already underway; public recruiting contact research is an optional next lane.",
    45,
  );
}

export function buildCommandJobItem(input: CommandJobInput): CommandJobItem {
  const nextAction = recommendJobNextAction(input);
  const stage: CommandJobItem["stage"] = input.priority === "parked"
    ? "parked"
    : nextAction.kind === "capture_evidence" || nextAction.kind === "review_quality"
      ? "evidence"
      : nextAction.kind.includes("application")
        ? "application"
        : nextAction.kind.includes("contact")
          ? "contact"
          : "outreach";
  return { ...input, nextAction, stage };
}

export function ecosystemLeadNextAction(lead: CommandEcosystemLead): CommandAction {
  if (lead.sourceMode === "ecosystem_index_lead" || lead.requiresOfficialSourceRegistration) {
    return action(
      "review_register_source",
      "Review and register official source",
      lead.url,
      "This ecosystem result is outside Scout's registered source set and stays review-only until official provenance is verified.",
      82,
      true,
    );
  }
  if (lead.sourceMode === "portfolio_board" || lead.requiresOfficialEmployerResolution) {
    return action(
      "resolve_portfolio_employer",
      "Resolve the portfolio employer",
      lead.url,
      "Investor/accelerator portfolio boards are lead sources only; resolve the startup's official careers or ATS posting before Safe Fill.",
      86,
      true,
    );
  }
  return action(
    "capture_direct_ecosystem_role",
    "Capture the official role",
    lead.url,
    "This is a direct institution surface. Preserve the exact official role evidence before application preparation or contact research.",
    84,
    true,
  );
}

const PRIORITY_WEIGHT: Record<CommandPriority, number> = { A: 4, B: 3, C: 2, parked: 1 };

export function sortCommandJobs(items: CommandJobItem[]) {
  return [...items].sort((left, right) => {
    const actionDelta = right.nextAction.urgency - left.nextAction.urgency;
    if (actionDelta) return actionDelta;
    const priorityDelta = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
    if (priorityDelta) return priorityDelta;
    return `${left.company} ${left.title}`.localeCompare(`${right.company} ${right.title}`);
  });
}

export function summarizeCommandJobs(items: CommandJobItem[]) {
  return {
    total: items.length,
    priorityA: items.filter((item) => item.priority === "A").length,
    needsEvidence: items.filter((item) => item.nextAction.kind === "capture_evidence").length,
    applicationReview: items.filter((item) => item.nextAction.kind === "review_application" || item.nextAction.kind === "resolve_application_input").length,
    contactReview: items.filter((item) => item.nextAction.kind === "review_contact").length,
    outreachReview: items.filter((item) => item.stage === "outreach").length,
    parked: items.filter((item) => item.priority === "parked").length,
  };
}
