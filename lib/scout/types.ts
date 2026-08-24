import type { WorkplaceType } from "../types";

export type AtsProvider = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "workday" | "bamboohr" | "recruitee";

export type CompanySource = {
  id: string;
  provider: AtsProvider;
  companyName: string;
  boardToken: string;
  companyDomain: string;
  careersUrl: string | null;
  enabled: boolean;
};

export type NormalizedJobSnapshot = {
  sourceProvider: AtsProvider;
  externalId: string;
  canonicalUrl: string;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: WorkplaceType;
  score: number;
  scoreExplanation: string[];
  eligibilityRisks: string[];
  postedAt?: string;
};

export type JobSnapshotRecord = NormalizedJobSnapshot & {
  id: string;
  jobId: string;
  syncRunId: string;
  version: number;
  contentHash: string;
  capturedAt: string;
};

export type JobRecord = {
  id: string;
  sourceId: string;
  externalId: string;
  lifecycleState: "active" | "closed";
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
  missingCount: number;
  currentSnapshot: JobSnapshotRecord;
  snapshots: JobSnapshotRecord[];
};

export type SyncRun = {
  id: string;
  sourceId: string;
  idempotencyKey: string;
  status: "running" | "completed" | "failed";
  observedAt: string;
  discoveredCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  closedCount: number;
  completedAt: string | null;
  error: string | null;
};