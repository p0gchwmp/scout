import { classifyPlatformUrl, type ScoutPlatformId } from "./platform-registry.ts";

export const AGENT_TASK_TYPES = Object.freeze([
  "resolve_official_posting",
  "capture_official_snapshot",
  "prepare_application",
  "browser_assist_application",
  "research_contacts",
  "draft_outreach",
  "create_gmail_draft",
] as const);

export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];
export type AgentTaskPlanItem = {
  type: AgentTaskType;
  platformId: ScoutPlatformId;
  requiresReview: boolean;
  reason: string;
};

export type AgentPlanningInput = {
  url: string;
  hasOfficialSnapshot: boolean;
  applicationPrepared: boolean;
  hasAcceptedContact: boolean;
  outreachDraftReady: boolean;
  gmailDraftCreated: boolean;
};

export const AGENT_EXECUTION_CAPABILITIES = Object.freeze({
  planDiscovery: true,
  planResolution: true,
  planApplicationPreparation: true,
  planContactResearch: true,
  planOutreachDraft: true,
  planGmailDraft: true,
  sendEmail: false,
  submitApplication: false,
  bypassAccessControls: false,
} as const);

export function planAgentTasks(input: AgentPlanningInput): AgentTaskPlanItem[] {
  const platform = classifyPlatformUrl(input.url);
  if (platform.id === "unknown") {
    return [{ type: "resolve_official_posting", platformId: platform.id, requiresReview: true, reason: "Unrecognized platform requires review before any fetch or automation." }];
  }

  const tasks: AgentTaskPlanItem[] = [];
  if (!input.hasOfficialSnapshot) {
    if (platform.requiresOfficialResolution) {
      tasks.push({
        type: "resolve_official_posting",
        platformId: platform.id,
        requiresReview: platform.discovery === "user_session",
        reason: `${platform.label} is a lead surface; resolve to an official employer/ATS posting before application automation.`,
      });
      return tasks;
    }
    tasks.push({
      type: "capture_official_snapshot",
      platformId: platform.id,
      requiresReview: platform.resolution === "browser_capture",
      reason: `Capture immutable official posting evidence from ${platform.label}.`,
    });
    return tasks;
  }

  if (!input.applicationPrepared) {
    tasks.push({
      type: platform.application === "structured_prepare" ? "prepare_application" : "browser_assist_application",
      platformId: platform.id,
      requiresReview: platform.application !== "structured_prepare",
      reason: platform.application === "reviewed_easy_apply"
        ? "Prepare the visible Easy Apply flow in the user session; final submission remains approval-gated."
        : platform.application === "browser_assist"
          ? "Prepare the visible candidate form using verified profile fields and stop on sensitive/unknown questions."
          : "Prepare a deterministic application packet from the immutable snapshot and approved claims.",
    });
  }

  if (!input.hasAcceptedContact) {
    tasks.push({
      type: "research_contacts",
      platformId: platform.id,
      requiresReview: true,
      reason: "Search approved official company/recruiting sources for explicitly published business contact evidence.",
    });
    return tasks;
  }

  if (!input.outreachDraftReady) {
    tasks.push({
      type: "draft_outreach",
      platformId: platform.id,
      requiresReview: true,
      reason: "Use the immutable job snapshot, accepted contact evidence and approved claim IDs to draft personalized outreach.",
    });
    return tasks;
  }

  if (!input.gmailDraftCreated) {
    tasks.push({
      type: "create_gmail_draft",
      platformId: platform.id,
      requiresReview: false,
      reason: "Create a Gmail draft only; no send operation exists in the agent task model.",
    });
  }

  return tasks;
}
