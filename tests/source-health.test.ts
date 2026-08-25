import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_HEALTH_CAPABILITIES,
  assessSourceHealth,
} from "../lib/scout/source-health.ts";

const now = new Date("2026-08-25T06:00:00.000Z");

function completed(observedAt = "2026-08-25T05:00:00.000Z", discoveredCount = 2) {
  return {
    status: "completed" as const,
    observedAt,
    completedAt: observedAt,
    discoveredCount,
    createdCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    closedCount: 0,
    error: null,
  };
}

function failed(error: string) {
  return {
    status: "failed" as const,
    observedAt: "2026-08-25T05:00:00.000Z",
    completedAt: "2026-08-25T05:00:00.000Z",
    discoveredCount: 0,
    createdCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    closedCount: 0,
    error,
  };
}

function health(latestRun: ReturnType<typeof completed> | ReturnType<typeof failed> | null, options?: { enabled?: boolean; lastSuccessfulAt?: string | null }) {
  return assessSourceHealth({
    enabled: options?.enabled ?? true,
    latestRun,
    lastSuccessfulAt: options?.lastSuccessfulAt ?? (latestRun?.status === "completed" ? latestRun.completedAt : null),
    activeJobs: 3,
    totalJobs: 5,
    now,
  });
}

test("recent successful source observations are healthy even when zero internships are found", () => {
  const result = health(completed("2026-08-25T05:00:00.000Z", 0));
  assert.equal(result.state, "healthy");
  assert.match(result.reason, /completed successfully with no internship leads/i);
  assert.equal(result.activeJobs, 3);
});

test("successful source observations become stale after the bounded seven-day window", () => {
  const old = completed("2026-08-16T05:00:00.000Z", 1);
  const result = health(old, { lastSuccessfulAt: old.completedAt });
  assert.equal(result.state, "stale");
  assert.ok((result.latestAgeDays ?? 0) >= 7);
});

test("temporary failures are degraded while 404/catalog/adapter evidence requires review", () => {
  assert.equal(health(failed("Public ATS source timed out after one bounded retry")).state, "degraded");
  assert.equal(health(failed("Registered public ATS source no longer resolves and needs catalog review")).state, "needs_review");
  assert.equal(health(failed("HTTP 404 from controlled source")).state, "needs_review");
  assert.equal(health(failed("Public ATS source returned an unexpected payload and needs adapter review")).state, "needs_review");
});

test("sources with no persisted run are not checked and disabled sources stay explicitly disabled", () => {
  assert.equal(health(null).state, "not_checked");
  assert.equal(health(completed(), { enabled: false }).state, "disabled");
});

test("source health remains diagnostic and cannot disable, remove or poll sources", () => {
  assert.equal(SOURCE_HEALTH_CAPABILITIES.persistedEvidenceOnly, true);
  assert.equal(SOURCE_HEALTH_CAPABILITIES.autoDisableSource, false);
  assert.equal(SOURCE_HEALTH_CAPABILITIES.autoRemoveSource, false);
  assert.equal(SOURCE_HEALTH_CAPABILITIES.pollExternalSource, false);
});
