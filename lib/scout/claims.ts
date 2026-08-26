export type CandidateClaim = {
  id: string;
  statement: string;
  evidence: string;
  status: "draft" | "approved" | "rejected";
  version: number;
  createdAt: string;
  approvedAt: string | null;
};

export const SYNTHETIC_DEMO_CLAIM_ID_PREFIX = "demo_claim_";
export const SYNTHETIC_DEMO_EVIDENCE_PREFIX = "LOCAL DEMO ONLY";
const NUMBER_TOKEN = /(?:₹|\$|€|£)?\d+(?:\.\d+)?%?/g;

type ClaimForSelection = {
  id: string;
  evidence?: string;
  status: "draft" | "approved" | "rejected";
};

export function isSyntheticDemoClaim(claim: Pick<ClaimForSelection, "id" | "evidence">) {
  return claim.id.startsWith(SYNTHETIC_DEMO_CLAIM_ID_PREFIX)
    || claim.evidence?.trimStart().startsWith(SYNTHETIC_DEMO_EVIDENCE_PREFIX) === true;
}

export function hasUnanchoredStatementNumbers(claim: { statement?: string; evidence?: string }) {
  const statementNumbers = new Set(claim.statement?.match(NUMBER_TOKEN) ?? []);
  if (!statementNumbers.size) return false;
  const evidenceNumbers = new Set(claim.evidence?.match(NUMBER_TOKEN) ?? []);
  return [...statementNumbers].some((number) => !evidenceNumbers.has(number));
}

export function selectUsableApprovedClaims<T extends ClaimForSelection & { statement?: string }>(
  claims: readonly T[],
  { allowSyntheticDemo = false, allowUnanchoredNumbers = false }: { allowSyntheticDemo?: boolean; allowUnanchoredNumbers?: boolean } = {},
): T[] {
  const approved = claims.filter((claim) => claim.status === "approved" && (allowUnanchoredNumbers || !hasUnanchoredStatementNumbers(claim)));
  const real = approved.filter((claim) => !isSyntheticDemoClaim(claim));
  if (real.length) return real;
  return allowSyntheticDemo ? approved : [];
}

export function editClaim(claim: CandidateClaim, changes: Partial<Pick<CandidateClaim, "statement" | "evidence">>): CandidateClaim {
  if (claim.status === "approved") throw new Error("Approved candidate claims are immutable");
  if (claim.status === "rejected") throw new Error("Rejected candidate claims cannot be edited");
  const statement = changes.statement?.trim() ?? claim.statement;
  const evidence = changes.evidence?.trim() ?? claim.evidence;
  if (!statement || !evidence) throw new Error("Claim statement and evidence are required");
  return { ...claim, statement, evidence };
}

export function approveClaim(claim: CandidateClaim, approvedAt: string): CandidateClaim {
  if (claim.status !== "draft") throw new Error("Only draft claims can be approved");
  return { ...claim, status: "approved", approvedAt };
}

export function rejectClaim(claim: CandidateClaim): CandidateClaim {
  if (claim.status !== "draft") throw new Error("Only draft claims can be rejected");
  return { ...claim, status: "rejected", approvedAt: null };
}
