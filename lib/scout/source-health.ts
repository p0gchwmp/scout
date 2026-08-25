export const SOURCE_HEALTH_CAPABILITIES = Object.freeze({
  persistedEvidenceOnly: true,
  autoDisableSource: false,
  autoRemoveSource: false,
  pollExternalSource: false,
} as const);

export const SOURCE_STALE_AFTER_DAYS = 7;

export type SourceHealthState = "healthy" | "degraded" | "stale" | "needs_review" | "running" | "not_checked" | "disabled";

export type SourceHealthRun = {
  status: "running" | "completed" | "failed";
  observedAt: string;
  completedAt: string | null;
  discoveredCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  closedCount: number;
  error: string | null;
};

function ageDays(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

function requiresCatalogReview(error: string | null | undefined) {
  return /catalog review|no longer resolves|HTTP 404|adapter review|unexpected payload/i.test(error ?? "");
}

export function assessSourceHealth(input: {
  enabled: boolean;
  latestRun: SourceHealthRun | null;
  lastSuccessfulAt: string | null;
  activeJobs: number;
  totalJobs: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const latestObservedAt = input.latestRun?.completedAt ?? input.latestRun?.observedAt ?? null;
  const latestAgeDays = ageDays(latestObservedAt, now);
  const lastSuccessAgeDays = ageDays(input.lastSuccessfulAt, now);

  let state: SourceHealthState;
  let label: string;
  let reason: string;

  if (!input.enabled) {
    state = "disabled";
    label = "Disabled";
    reason = "This source is disabled in Scout's registry.";
  } else if (!input.latestRun) {
    state = "not_checked";
    label = "Not checked";
    reason = "No persisted source observation exists yet.";
  } else if (input.latestRun.status === "running") {
    state = "running";
    label = "Checking";
    reason = "A source sync is currently running.";
  } else if (input.latestRun.status === "failed" && requiresCatalogReview(input.latestRun.error)) {
    state = "needs_review";
    label = "Review source";
    reason = input.latestRun.error || "The registered ATS source needs catalog or adapter review.";
  } else if (input.latestRun.status === "failed") {
    state = "degraded";
    label = "Degraded";
    reason = input.latestRun.error || "The most recent source check failed.";
  } else if (latestAgeDays !== null && latestAgeDays >= SOURCE_STALE_AFTER_DAYS) {
    state = "stale";
    label = "Stale";
    reason = `Last successful source check was ${latestAgeDays} days ago.`;
  } else {
    state = "healthy";
    label = "Healthy";
    reason = input.latestRun.discoveredCount > 0
      ? `Latest check found ${input.latestRun.discoveredCount} internship lead${input.latestRun.discoveredCount === 1 ? "" : "s"}.`
      : "Latest source check completed successfully with no internship leads.";
  }

  return {
    state,
    label,
    reason,
    latestObservedAt,
    latestAgeDays,
    lastSuccessfulAt: input.lastSuccessfulAt,
    lastSuccessAgeDays,
    activeJobs: input.activeJobs,
    totalJobs: input.totalJobs,
    latestRun: input.latestRun,
    capabilities: SOURCE_HEALTH_CAPABILITIES,
  };
}
