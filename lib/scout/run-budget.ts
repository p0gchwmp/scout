export const RUN_REQUEST_BUDGET_MS = 24_000;
export const RUN_RESPONSE_RESERVE_MS = 4_000;
const MIN_AGENT_TIMEOUT_MS = 250;

export function createRunBudget(
  now: () => number = Date.now,
  limitMs = RUN_REQUEST_BUDGET_MS,
  responseReserveMs = RUN_RESPONSE_RESERVE_MS,
) {
  if (!Number.isFinite(limitMs) || limitMs <= responseReserveMs || responseReserveMs < 0) {
    throw new Error("Scout run budget configuration is invalid");
  }
  const startedAt = now();

  function elapsedMs() {
    return Math.max(0, now() - startedAt);
  }

  function remainingMs() {
    return Math.max(0, limitMs - elapsedMs());
  }

  function canSpend(workMs = 0) {
    return remainingMs() > responseReserveMs + Math.max(0, workMs);
  }

  function boundedAgentTimeout(capMs: number) {
    if (!Number.isInteger(capMs) || capMs < MIN_AGENT_TIMEOUT_MS) {
      throw new Error("Scout agent timeout cap is invalid");
    }
    const available = remainingMs() - responseReserveMs;
    if (available < MIN_AGENT_TIMEOUT_MS) return 0;
    return Math.min(capMs, Math.floor(available));
  }

  return Object.freeze({ elapsedMs, remainingMs, canSpend, boundedAgentTimeout });
}
