import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("health compatibility path cannot bypass Scout owner auth", async () => {
  const canonical = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  const alias = await readFile(new URL("../app/health/route.ts", import.meta.url), "utf8");

  assert.match(alias, /export \{ GET \} from "\.\.\/api\/health\/route"/);
  assert.doesNotMatch(alias, /Response\.json/);
  assert.match(canonical, /requireScoutApiUser\(\)/);
});
