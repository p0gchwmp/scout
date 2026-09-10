const TRIGGER_NAME = "candidate_claims_approved_immutable_update";
const IMMUTABILITY_MESSAGE = "approved candidate claims are immutable";

export const CLAIM_RETIREMENT_TRIGGER_SQL = `CREATE TRIGGER \`${TRIGGER_NAME}\`
BEFORE UPDATE ON \`candidate_claims\`
WHEN OLD.\`status\` = 'approved'
  AND NOT (
    OLD.\`approved_at\` IS NOT NULL
    AND NEW.\`id\` IS OLD.\`id\`
    AND NEW.\`statement\` IS OLD.\`statement\`
    AND NEW.\`evidence\` IS OLD.\`evidence\`
    AND NEW.\`status\` = 'rejected'
    AND NEW.\`version\` = OLD.\`version\` + 1
    AND NEW.\`approved_at\` IS OLD.\`approved_at\`
    AND NEW.\`created_at\` IS OLD.\`created_at\`
  )
BEGIN SELECT RAISE(ABORT, '${IMMUTABILITY_MESSAGE}'); END;`;

function normalizeTriggerSql(value: string) {
  return value
    .toLowerCase()
    .replace(/[`"[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRetirementAwareTrigger(sql: string) {
  const normalized = normalizeTriggerSql(sql);
  return normalized.includes("before update on candidate_claims")
    && normalized.includes("old.status = 'approved'")
    && normalized.includes("new.status = 'rejected'")
    && normalized.includes("new.version = old.version + 1")
    && normalized.includes("new.statement is old.statement")
    && normalized.includes("new.evidence is old.evidence")
    && normalized.includes("new.approved_at is old.approved_at")
    && normalized.includes(IMMUTABILITY_MESSAGE);
}

function isLegacyImmutableTrigger(sql: string) {
  const normalized = normalizeTriggerSql(sql);
  return normalized.includes("before update on candidate_claims")
    && normalized.includes("old.status = 'approved'")
    && normalized.includes(IMMUTABILITY_MESSAGE)
    && !normalized.includes("new.status = 'rejected'");
}

export async function ensureClaimRetirementTrigger(database: D1Database) {
  const current = await database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).bind(TRIGGER_NAME).first<{ sql?: string }>();
  const currentSql = typeof current?.sql === "string" ? current.sql : "";

  if (!currentSql) {
    throw new Error("Candidate-claim immutability trigger is missing; refusing retirement");
  }
  if (isRetirementAwareTrigger(currentSql)) return { upgraded: false } as const;
  if (!isLegacyImmutableTrigger(currentSql)) {
    throw new Error("Candidate-claim immutability trigger has an unexpected definition; refusing retirement");
  }

  await database.batch([
    database.prepare(`DROP TRIGGER \`${TRIGGER_NAME}\``),
    database.prepare(CLAIM_RETIREMENT_TRIGGER_SQL),
  ]);

  const upgraded = await database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).bind(TRIGGER_NAME).first<{ sql?: string }>();
  const upgradedSql = typeof upgraded?.sql === "string" ? upgraded.sql : "";
  if (!isRetirementAwareTrigger(upgradedSql)) {
    throw new Error("Candidate-claim retirement trigger upgrade did not verify; refusing retirement");
  }
  return { upgraded: true } as const;
}
