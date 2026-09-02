import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("local dev runtime handles unexpected Vinext exits explicitly and boundedly", async () => {
  const source = await readFile(new URL("../scripts/scout-dev.mjs", import.meta.url), "utf8");

  assert.match(source, /let vinextRestartCount = 0/);
  assert.match(source, /code === 0 && vinextRestartCount < 1/);
  assert.match(source, /restarting once/);
  assert.match(source, /Scout web runtime stopped unexpectedly/);
  assert.match(source, /signal === "SIGINT" \? 130 : \(code \?\? 1\)/);

  assert.doesNotMatch(source, /while\s*\([^)]*vinextRestart/i, "Vinext restarts must stay bounded");
});
