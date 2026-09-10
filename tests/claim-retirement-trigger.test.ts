import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_RETIREMENT_TRIGGER_SQL,
  ensureClaimRetirementTrigger,
} from "../lib/scout/claim-retirement-trigger.ts";

const LEGACY_TRIGGER_SQL = `CREATE TRIGGER candidate_claims_approved_immutable_update
BEFORE UPDATE ON candidate_claims
WHEN OLD.status = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved candidate claims are immutable'); END`;

class FakePreparedStatement {
  constructor(
    readonly sql: string,
    private readonly database: FakeDatabase,
  ) {}

  bind() { return this; }

  async first<T>() {
    if (!this.sql.includes("sqlite_master")) return null;
    return { sql: this.database.triggerSql } as T;
  }
}

class FakeDatabase {
  batches = 0;

  constructor(public triggerSql: string) {}

  prepare(sql: string) {
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: FakePreparedStatement[]) {
    this.batches += 1;
    assert.equal(statements.length, 2);
    assert.match(statements[0].sql, /DROP TRIGGER/);
    assert.match(statements[1].sql, /CREATE TRIGGER/);
    this.triggerSql = CLAIM_RETIREMENT_TRIGGER_SQL;
    return [{ success: true }, { success: true }];
  }
}

test("runtime trigger upgrade replaces only the known legacy approved-claim trigger", async () => {
  const database = new FakeDatabase(LEGACY_TRIGGER_SQL);
  const first = await ensureClaimRetirementTrigger(database as unknown as D1Database);
  assert.deepEqual(first, { upgraded: true });
  assert.equal(database.batches, 1);

  const second = await ensureClaimRetirementTrigger(database as unknown as D1Database);
  assert.deepEqual(second, { upgraded: false });
  assert.equal(database.batches, 1);
});

test("runtime trigger upgrade fails closed when the trigger is missing or unfamiliar", async () => {
  await assert.rejects(
    ensureClaimRetirementTrigger(new FakeDatabase("") as unknown as D1Database),
    /trigger is missing; refusing retirement/,
  );
  await assert.rejects(
    ensureClaimRetirementTrigger(new FakeDatabase("CREATE TRIGGER unexpected AFTER UPDATE ON candidate_claims BEGIN SELECT 1; END") as unknown as D1Database),
    /unexpected definition; refusing retirement/,
  );
});
