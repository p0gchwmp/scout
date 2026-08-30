export const LEAD_PROMOTION_CAPABILITIES = Object.freeze({
  explicitOwnerActionRequired: true,
  ephemeralLeadOnly: true,
  officialAtsRefetchRequired: true,
  independentCompanyAndRoleMatchRequired: true,
  persistSearchSnippet: false,
  autoRegisterVerifiedAtsSource: true,
  autoTrustUnknownEcosystemSource: false,
  immutableSnapshotRequired: true,
  guessEmails: false,
  scrapePersonalContacts: false,
  createGmailDraft: false,
  sendEmail: false,
  submitApplication: false,
} as const);

export type PromotableLeadMode = "direct_institution" | "portfolio_board" | "ecosystem_index_lead";

export type LeadPromotionPayload = {
  action: "resolve_promote";
  leadUrl: string;
  companyHint: string;
  title: string;
  sourceMode: PromotableLeadMode;
};

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function requiresEmployerHint(sourceMode: PromotableLeadMode) {
  return sourceMode !== "direct_institution";
}

export function parseLeadPromotionPayload(value: unknown): LeadPromotionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const raw = value as Record<string, unknown>;
  if (raw.action !== "resolve_promote") throw new Error("A supported lead-promotion action is required");
  const sourceMode = raw.sourceMode;
  if (sourceMode !== "direct_institution" && sourceMode !== "portfolio_board" && sourceMode !== "ecosystem_index_lead") {
    throw new Error("A valid ecosystem lead mode is required");
  }
  const leadUrl = httpsUrl(raw.leadUrl);
  const companyHint = clean(raw.companyHint, 200);
  const title = clean(raw.title, 300);
  if (!leadUrl) throw new Error("A valid HTTPS lead URL is required");
  if (companyHint.length < 2) throw new Error("Employer/company name is required for official-source resolution");
  if (title.length < 2) throw new Error("Role title is required for official-source resolution");
  return { action: "resolve_promote", leadUrl, companyHint, title, sourceMode };
}

export function leadPromotionIdempotencyKey(externalId: string, contentHash: string) {
  const external = clean(externalId, 100).replace(/[^A-Za-z0-9._:-]+/g, "-");
  const hash = clean(contentHash, 128).replace(/[^A-Fa-f0-9]+/g, "").slice(0, 24);
  if (!external || hash.length < 12) throw new Error("Official role identity is incomplete");
  return `lead-promotion:${external}:${hash}`.slice(0, 220);
}
