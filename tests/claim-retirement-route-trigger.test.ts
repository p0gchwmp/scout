import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("approved-claim retirement upgrades the known legacy DB trigger before the write", async () => {
  const route = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
  const ensureIndex = route.indexOf("await ensureClaimRetirementTrigger(env.DB)");
  const updateIndex = route.indexOf("const [claim] = await db.update(candidateClaims)", ensureIndex);

  assert.match(route, /import \{ env \} from "cloudflare:workers"/);
  assert.match(route, /ensureClaimRetirementTrigger/);
  assert.ok(ensureIndex >= 0, "retirement route must ensure the DB trigger supports the constrained transition");
  assert.ok(updateIndex > ensureIndex, "trigger upgrade must happen before the retirement update");
  assert.match(route, /if \(!current\.approvedAt\)/);
});
