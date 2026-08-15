export type CandidateClaim = {
  id: string;
  statement: string;
  evidence: string;
  status: "draft" | "approved" | "rejected";
  version: number;
  createdAt: string;
  approvedAt: string | null;
};

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
