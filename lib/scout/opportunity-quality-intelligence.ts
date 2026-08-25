export const OPPORTUNITY_QUALITY_INTELLIGENCE_CAPABILITIES = Object.freeze({
  persistedEvidenceOnly: true,
  officialSourcePreferred: true,
  extractPublishedCompensation: true,
  extractPublishedDuration: true,
  extractPublishedWorkArrangement: true,
  inferMissingCompensation: false,
  inferCompanyLegitimacy: false,
  autoRejectOpportunity: false,
  modifyResumeFitScore: false,
  geographyBias: false,
} as const);

export type OpportunityQualityTier = "strong_evidence" | "review" | "low_signal" | "red_flag";
export type OpportunityQualityFlagSeverity = "info" | "caution" | "high";
export type PublishedCompensationStatus = "explicit_paid" | "explicit_unpaid" | "commission_only" | "mentioned" | "not_published";
export type PublishedArrangement = "remote" | "hybrid" | "onsite" | "unspecified";

export type OpportunityQualityJob = {
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType?: string | null;
  source: string;
  canonicalUrl: string;
  sourceRegistryId?: string | null;
  currentSnapshotId?: string | null;
  postedAt?: string | null;
  lastSeenAt?: string | null;
  lifecycleState?: "active" | "closed" | string;
};

export type OpportunityQualitySource = {
  id: string;
  provider: string;
  companyName: string;
  companyDomain: string;
  careersUrl?: string | null;
  sourceUrl?: string | null;
  registered?: boolean;
  enabled?: boolean;
  health?: { state?: string; label?: string; reason?: string } | null;
};

export type OpportunityQualityFlag = {
  code: string;
  severity: OpportunityQualityFlagSeverity;
  label: string;
  evidence: string;
};

export type OpportunityQualityAssessment = {
  score: number;
  tier: OpportunityQualityTier;
  label: string;
  evidenceLabel: string;
  officialSnapshot: boolean;
  registeredSource: boolean;
  companyDomain: string | null;
  careersUrl: string | null;
  provider: string;
  compensation: { status: PublishedCompensationStatus; text: string | null };
  duration: string | null;
  arrangement: PublishedArrangement;
  arrangementEvidence: string | null;
  structureSignals: string[];
  flags: OpportunityQualityFlag[];
  reasons: string[];
  caveats: string[];
};

const EARLY_CAREER_PATTERN = /\b(?:intern|internship|trainee|apprentice|co[- ]?op|graduate|new grad|entry[- ]?level|fresher|student|associate)\b/i;
const PAID_PATTERN = /(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp|aed|sgd)\s?[\d,.]+(?:\s*(?:-|–|to)\s*(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp|aed|sgd)?\s?[\d,.]+)?(?:\s*\/\s*(?:month|mo|week|wk|hour|hr|year|yr))?|\b(?:paid internship|paid intern|stipend(?:ed)?\s*(?:of|:)?\s*(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp|aed|sgd)?\s?[\d,.]+)\b/i;
const UNPAID_PATTERN = /\b(?:unpaid internship|unpaid intern|this (?:role|internship) is unpaid|no stipend|without stipend|unpaid position)\b/i;
const COMMISSION_ONLY_PATTERN = /\b(?:commission[- ]only|commission based only|solely commission|100% commission)\b/i;
const FEE_PATTERN = /\b(?:registration fee|training fee|application fee|security deposit|refundable deposit|pay.{0,35}(?:join|internship|training)|fee.{0,35}(?:join|internship|training))\b/i;
const UNPAID_TRIAL_PATTERN = /\b(?:unpaid trial|unpaid probation|work for free|free trial work)\b/i;
const DURATION_PATTERNS = [
  /\b(?:duration\s*[-:]?\s*)?(\d{1,2}\s*(?:weeks?|months?))\b/i,
  /\b((?:three|four|five|six|eight|nine|twelve)\s+(?:weeks?|months?))\b/i,
  /\b((?:summer|winter)\s+internship)\b/i,
] as const;
const MENTORSHIP_PATTERN = /\b(?:mentor|mentorship|coaching|supervision|buddy program|learning and development)\b/i;
const PROJECT_PATTERN = /\b(?:project|deliverable|ownership|responsibilit(?:y|ies)|cross[- ]functional|presentation|research project|capstone)\b/i;
const CONVERSION_PATTERN = /\b(?:return offer|pre[- ]placement offer|ppo|full[- ]time conversion|conversion to full[- ]time)\b/i;
const NEGATED_RISK_PREFIX = /(?:\b(?:no|not|never|without)\b.{0,35}|\bdo(?:es)?\s+not\s+(?:charge|require|ask)\b.{0,45})$/i;

function cleanText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function excerptAround(text: string, match: RegExpMatchArray | null, radius = 70) {
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end).trim().slice(0, 260);
}

function firstAffirmativeMatch(text: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
    if (match.index === undefined) continue;
    const sentencePrefix = text.slice(Math.max(0, match.index - 80), match.index).split(/[.!?]/).pop() ?? "";
    if (NEGATED_RISK_PREFIX.test(sentencePrefix)) continue;
    return match;
  }
  return null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function daysOld(value: string | null | undefined, now: Date) {
  const timestamp = parseDate(value);
  return timestamp === null ? null : Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

function normalizedDomain(value: string | null | undefined) {
  const domain = value?.trim().toLowerCase() ?? "";
  if (!domain || domain.endsWith(".invalid") || domain === "unknown") return null;
  return domain;
}

function compensationFrom(text: string) {
  const commission = firstAffirmativeMatch(text, COMMISSION_ONLY_PATTERN);
  if (commission) return { status: "commission_only" as const, text: excerptAround(text, commission) };
  const unpaid = firstAffirmativeMatch(text, UNPAID_PATTERN);
  if (unpaid) return { status: "explicit_unpaid" as const, text: excerptAround(text, unpaid) };
  const paid = firstAffirmativeMatch(text, PAID_PATTERN);
  if (paid) return { status: "explicit_paid" as const, text: excerptAround(text, paid) };
  const mentioned = text.match(/\b(?:compensation|salary|stipend|pay|remuneration)\b/i);
  if (mentioned) return { status: "mentioned" as const, text: excerptAround(text, mentioned) };
  return { status: "not_published" as const, text: null };
}

function durationFrom(text: string) {
  for (const pattern of DURATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return (match[1] ?? match[0]).trim().slice(0, 80);
  }
  return null;
}

function arrangementFrom(job: OpportunityQualityJob, text: string): { arrangement: PublishedArrangement; evidence: string | null } {
  const workplace = String(job.workplaceType ?? "").toLowerCase();
  if (workplace === "remote") return { arrangement: "remote", evidence: "Persisted workplace type: remote" };
  if (workplace === "hybrid") return { arrangement: "hybrid", evidence: "Persisted workplace type: hybrid" };
  if (workplace === "onsite" || workplace === "on-site" || workplace === "office") return { arrangement: "onsite", evidence: `Persisted workplace type: ${job.workplaceType}` };
  const hybrid = text.match(/\bhybrid\b/i);
  if (hybrid) return { arrangement: "hybrid", evidence: excerptAround(text, hybrid) };
  const remote = text.match(/\b(?:remote|work from home|distributed)\b/i);
  if (remote) return { arrangement: "remote", evidence: excerptAround(text, remote) };
  const onsite = text.match(/\b(?:on[- ]?site|in[- ]office|work from office)\b/i);
  if (onsite) return { arrangement: "onsite", evidence: excerptAround(text, onsite) };
  return { arrangement: "unspecified", evidence: null };
}

function sourceEvidence(job: OpportunityQualityJob, source: OpportunityQualitySource | null) {
  const officialSnapshot = Boolean(job.currentSnapshotId);
  const registeredSource = Boolean(source?.registered ?? source?.id);
  const companyDomain = normalizedDomain(source?.companyDomain);
  const careersUrl = source?.careersUrl?.trim() || source?.sourceUrl?.trim() || null;
  const provider = source?.provider || job.source;
  const sourceHealthy = source?.health?.state === "healthy";
  const sourceAttention = source?.health?.state === "degraded" || source?.health?.state === "needs_review" || source?.health?.state === "stale";
  return { officialSnapshot, registeredSource, companyDomain, careersUrl, provider, sourceHealthy, sourceAttention };
}

export function assessOpportunityQuality(
  job: OpportunityQualityJob,
  source: OpportunityQualitySource | null = null,
  now = new Date(),
): OpportunityQualityAssessment {
  const text = cleanText(`${job.title} ${job.description} ${job.location}`);
  const sourceInfo = sourceEvidence(job, source);
  const compensation = compensationFrom(text);
  const duration = durationFrom(text);
  const arrangement = arrangementFrom(job, text);
  const flags: OpportunityQualityFlag[] = [];
  const structureSignals: string[] = [];
  const reasons: string[] = [];
  const caveats: string[] = [];

  if (EARLY_CAREER_PATTERN.test(job.title)) structureSignals.push("Early-career role is explicit in the title");
  if (MENTORSHIP_PATTERN.test(text)) structureSignals.push("Mentorship / supervised learning language is published");
  if (PROJECT_PATTERN.test(text)) structureSignals.push("Concrete project / responsibility language is published");
  if (CONVERSION_PATTERN.test(text)) structureSignals.push("Return-offer / conversion language is published");
  if (duration) structureSignals.push(`Published duration: ${duration}`);
  if (arrangement.arrangement !== "unspecified") structureSignals.push(`Published work arrangement: ${arrangement.arrangement}`);
  if (compensation.status === "explicit_paid") structureSignals.push("Published compensation / stipend evidence is present");

  const fee = firstAffirmativeMatch(text, FEE_PATTERN);
  if (fee) flags.push({ code: "candidate_payment", severity: "high", label: "Candidate payment / fee language", evidence: excerptAround(text, fee) ?? fee[0] });
  const unpaidTrial = firstAffirmativeMatch(text, UNPAID_TRIAL_PATTERN);
  if (unpaidTrial) flags.push({ code: "unpaid_trial", severity: "high", label: "Unpaid trial-work language", evidence: excerptAround(text, unpaidTrial) ?? unpaidTrial[0] });
  if (compensation.status === "commission_only") flags.push({ code: "commission_only", severity: "high", label: "Commission-only compensation", evidence: compensation.text ?? "Commission-only language is published" });
  if (compensation.status === "explicit_unpaid") flags.push({ code: "unpaid", severity: "caution", label: "Explicitly unpaid opportunity", evidence: compensation.text ?? "Unpaid language is published" });

  const postedDays = daysOld(job.postedAt, now);
  if (postedDays !== null && postedDays > 120 && job.lifecycleState !== "closed") {
    flags.push({ code: "old_posting", severity: "caution", label: "Old active posting", evidence: `Published posting date is ${postedDays} days old` });
  }
  if (job.description.trim().length < 180) {
    flags.push({ code: "thin_description", severity: "info", label: "Thin posting detail", evidence: "Persisted description contains limited detail" });
  }
  if (sourceInfo.sourceAttention) {
    flags.push({ code: "source_health", severity: "caution", label: "Source needs attention", evidence: source?.health?.reason || source?.health?.label || "Latest source-health observation needs review" });
  }

  let score = 0;
  if (sourceInfo.officialSnapshot) score += 35;
  if (sourceInfo.registeredSource) score += 15;
  if (sourceInfo.companyDomain) score += 10;
  if (sourceInfo.careersUrl) score += 5;
  if (sourceInfo.sourceHealthy) score += 5;
  score += Math.min(18, structureSignals.length * 3);
  if (job.description.trim().length >= 500) score += 7;
  else if (job.description.trim().length >= 250) score += 4;
  if (postedDays !== null && postedDays <= 60) score += 5;
  if (flags.some((flag) => flag.severity === "high")) score = Math.min(score, 39);
  else if (flags.some((flag) => flag.severity === "caution")) score = Math.min(score, 69);
  score = Math.max(0, Math.min(100, score));

  let tier: OpportunityQualityTier;
  if (flags.some((flag) => flag.severity === "high")) tier = "red_flag";
  else if (!sourceInfo.officialSnapshot || !sourceInfo.registeredSource) tier = score >= 45 ? "review" : "low_signal";
  else if (score >= 75 && !flags.some((flag) => flag.severity === "caution")) tier = "strong_evidence";
  else tier = "review";

  const labels: Record<OpportunityQualityTier, string> = {
    strong_evidence: "Strong opportunity evidence",
    review: "Review opportunity details",
    low_signal: "Low-signal opportunity",
    red_flag: "Red flag — review carefully",
  };

  reasons.push(sourceInfo.officialSnapshot ? "Immutable official job snapshot is captured" : "Official immutable job snapshot is still missing");
  reasons.push(sourceInfo.registeredSource ? `Registered source: ${sourceInfo.provider}` : "No registered company source is bound to this job yet");
  if (sourceInfo.companyDomain) reasons.push(`Published company domain evidence: ${sourceInfo.companyDomain}`);
  if (structureSignals.length) reasons.push(...structureSignals);

  if (compensation.status === "not_published") caveats.push("Compensation was not found in persisted posting evidence; Scout does not infer paid or unpaid status.");
  if (!duration) caveats.push("Internship duration was not found in persisted posting evidence.");
  if (arrangement.arrangement === "unspecified") caveats.push("Work arrangement was not explicit in persisted posting evidence.");
  if (!sourceInfo.companyDomain) caveats.push("A verified company-domain value is not currently bound to this source; this alone does not imply the company is illegitimate.");
  caveats.push("Scout assesses evidence quality and explicit posting signals; it does not certify that a company or opportunity is legitimate.");

  return {
    score,
    tier,
    label: labels[tier],
    evidenceLabel: sourceInfo.officialSnapshot && sourceInfo.registeredSource ? "Official evidence bound" : sourceInfo.officialSnapshot ? "Official snapshot only" : "Needs official evidence",
    officialSnapshot: sourceInfo.officialSnapshot,
    registeredSource: sourceInfo.registeredSource,
    companyDomain: sourceInfo.companyDomain,
    careersUrl: sourceInfo.careersUrl,
    provider: sourceInfo.provider,
    compensation,
    duration,
    arrangement: arrangement.arrangement,
    arrangementEvidence: arrangement.evidence,
    structureSignals,
    flags,
    reasons,
    caveats,
  };
}
