import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compatibilityRoute = new URL("../app/health/route.ts", import.meta.url);
const canonicalRoute = new URL("../app/api/health/route.ts", import.meta.url);

test("/health reuses the canonical owner-authenticated Scout readiness handler", async () => {
  const [compatibility, canonical] = await Promise.all([
    readFile(compatibilityRoute, "utf8"),
    readFile(canonicalRoute, "utf8"),
  ]);

  assert.match(compatibility, /export \{ GET \} from "\.\.\/api\/health\/route"/);
  assert.match(canonical, /requireScoutApiUser\(\)/);
  assert.match(canonical, /applicationSubmission:\s*false/);
  assert.match(canonical, /emailSending:\s*false/);
});
