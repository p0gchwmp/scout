import { classifyRoleTaxonomy, ROLE_FAMILIES, type RoleFamilyId } from "./role-taxonomy.ts";

export const PREFERENCE_STORAGE_KEY = "scout.preferenceFeedback.v1";

export const PREFERENCE_CALIBRATION_CAPABILITIES = Object.freeze({
  browserLocal: true,
  explicitFeedbackOnly: true,
  savedStateIsNeutral: true,
  minimumTotalSignals: 4,
  minimumFamilySignals: 2,
  maximumAbsoluteNudge: 6,
  singleRejectionCanBlockFamily: false,
  hardEligibilityUnaffected: true,
  approvedEvidenceUnaffected: true,
  geographyLearning: false,
  automaticRoleHiding: false,
} as const);

export type PreferenceSignal = "interested" | "not_interested";

export type PreferenceFeedback = {
  jobId: string;
  signal: PreferenceSignal;
  recordedAt: string;
};

export type PreferenceJob = {
  id: string;
  title: string;
  description: string;
};

export type FamilyPreferenceCalibration = {
  familyId: RoleFamilyId;
  familyLabel: string;
  interested: number;
  notInterested: number;
  signalCount: number;
  adjustment: number;
  confidence: "none" | "emerging" | "established";
  label: string;
};

export type PreferenceCalibration = {
  active: boolean;
  totalSignals: number;
  interested: number;
  notInterested: number;
  minimumTotalSignals: number;
  families: FamilyPreferenceCalibration[];
  summary: string;
};

const MIN_TOTAL_SIGNALS = PREFERENCE_CALIBRATION_CAPABILITIES.minimumTotalSignals;
const MIN_FAMILY_SIGNALS = PREFERENCE_CALIBRATION_CAPABILITIES.minimumFamilySignals;
const MAX_NUDGE = PREFERENCE_CALIBRATION_CAPABILITIES.maximumAbsoluteNudge;

function validIsoDate(value: unknown) {
  return typeof value === "string" && value.length <= 100 && Number.isFinite(Date.parse(value));
}

function validSignal(value: unknown): value is PreferenceSignal {
  return value === "interested" || value === "not_interested";
}

export function parsePreferenceFeedback(value: string | null | undefined): PreferenceFeedback[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { return []; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const raw = parsed as { schemaVersion?: unknown; feedback?: unknown };
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.feedback) || raw.feedback.length > 500) return [];

  const byJob = new Map<string, PreferenceFeedback>();
  for (const item of raw.feedback) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const jobId = typeof row.jobId === "string" ? row.jobId.trim() : "";
    if (!jobId || jobId.length > 200 || !validSignal(row.signal) || !validIsoDate(row.recordedAt)) continue;
    const next = { jobId, signal: row.signal, recordedAt: row.recordedAt as string };
    const existing = byJob.get(jobId);
    if (!existing || Date.parse(next.recordedAt) >= Date.parse(existing.recordedAt)) byJob.set(jobId, next);
  }
  return [...byJob.values()].sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
}

export function serializePreferenceFeedback(feedback: PreferenceFeedback[]) {
  return JSON.stringify({ schemaVersion: 1, feedback: feedback.slice(0, 500) });
}

export function recordPreferenceFeedback(
  feedback: readonly PreferenceFeedback[],
  jobId: string,
  signal: PreferenceSignal | null,
  recordedAt = new Date().toISOString(),
): PreferenceFeedback[] {
  const id = jobId.trim();
  if (!id || id.length > 200) throw new Error("Preference feedback job id is invalid");
  if (!validIsoDate(recordedAt)) throw new Error("Preference feedback timestamp is invalid");
  const next = feedback.filter((item) => item.jobId !== id);
  if (signal) next.unshift({ jobId: id, signal, recordedAt });
  return next.slice(0, 500);
}

export function buildPreferenceCalibration(
  jobs: readonly PreferenceJob[],
  feedback: readonly PreferenceFeedback[],
): PreferenceCalibration {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const uniqueFeedback = new Map<string, PreferenceFeedback>();
  for (const item of feedback) {
    if (!jobsById.has(item.jobId) || !validSignal(item.signal)) continue;
    const existing = uniqueFeedback.get(item.jobId);
    if (!existing || Date.parse(item.recordedAt) >= Date.parse(existing.recordedAt)) uniqueFeedback.set(item.jobId, item);
  }

  const counts = new Map<RoleFamilyId, { interested: number; notInterested: number }>();
  let interested = 0;
  let notInterested = 0;
  for (const item of uniqueFeedback.values()) {
    const job = jobsById.get(item.jobId)!;
    const familyId = classifyRoleTaxonomy(job).primaryFamily.id;
    const current = counts.get(familyId) ?? { interested: 0, notInterested: 0 };
    if (item.signal === "interested") {
      current.interested += 1;
      interested += 1;
    } else {
      current.notInterested += 1;
      notInterested += 1;
    }
    counts.set(familyId, current);
  }

  const totalSignals = interested + notInterested;
  const active = totalSignals >= MIN_TOTAL_SIGNALS;
  const families = ROLE_FAMILIES.map((family): FamilyPreferenceCalibration => {
    const count = counts.get(family.id) ?? { interested: 0, notInterested: 0 };
    const signalCount = count.interested + count.notInterested;
    const raw = count.interested * 2 - count.notInterested * 2;
    const adjustment = active && signalCount >= MIN_FAMILY_SIGNALS
      ? Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, raw))
      : 0;
    const confidence: FamilyPreferenceCalibration["confidence"] = signalCount >= 4
      ? "established"
      : signalCount >= MIN_FAMILY_SIGNALS
        ? "emerging"
        : "none";
    const label = !active
      ? "Waiting for more feedback"
      : signalCount < MIN_FAMILY_SIGNALS
        ? "Not enough family-specific feedback"
        : adjustment > 0
          ? `+${adjustment} soft preference points`
          : adjustment < 0
            ? `${adjustment} soft preference points`
            : "Neutral preference signal";
    return {
      familyId: family.id,
      familyLabel: family.label,
      interested: count.interested,
      notInterested: count.notInterested,
      signalCount,
      adjustment,
      confidence,
      label,
    };
  });

  return {
    active,
    totalSignals,
    interested,
    notInterested,
    minimumTotalSignals: MIN_TOTAL_SIGNALS,
    families,
    summary: active
      ? `Soft calibration is active from ${totalSignals} explicit Shortlist/Reject decision${totalSignals === 1 ? "" : "s"}.`
      : `Scout needs ${Math.max(0, MIN_TOTAL_SIGNALS - totalSignals)} more explicit Shortlist/Reject decision${MIN_TOTAL_SIGNALS - totalSignals === 1 ? "" : "s"} before preference nudges activate.`,
  };
}

export function preferenceForFamily(calibration: PreferenceCalibration | undefined, familyId: RoleFamilyId) {
  return calibration?.families.find((family) => family.familyId === familyId) ?? null;
}
