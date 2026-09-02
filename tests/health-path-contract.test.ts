import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Scout health compatibility route remains a thin alias", async () => {
  const source = await readFile(new URL("../app/health/route.ts", import.meta.url), "utf8");
  assert.equal(source.includes("../api/health/route"), true);
});
