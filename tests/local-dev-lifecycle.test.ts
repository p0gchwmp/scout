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

  assert.match(source, /const VINEXT_OUTPUT_TAIL_BYTES = 16 \* 1024/);
  assert.match(source, /stdio: \["inherit", "pipe", "pipe"\]/);
  assert.match(source, /teeVinextOutput\(child\.stdout, process\.stdout\)/);
  assert.match(source, /teeVinextOutput\(child\.stderr, process\.stderr\)/);
  assert.match(source, /Vinext output tail before exit/);
  assert.match(source, /vinextOutputTail\.length > VINEXT_OUTPUT_TAIL_BYTES/);

  assert.doesNotMatch(source, /while\s*\([^)]*vinextRestart/i, "Vinext restarts must stay bounded");
});

test("outer local launcher reports the exact child exit reason before returning to the shell", async () => {
  const source = await readFile(new URL("../scripts/scout-local-run.mjs", import.meta.url), "utf8");

  assert.match(source, /const reason = signal \? `signal \$\{signal\}` : `code \$\{code \?\? "unknown"\}`/);
  assert.match(source, /Scout local development runtime exited \(\$\{reason\}\)\./);
  assert.match(source, /if \(signal\) process\.kill\(process\.pid, signal\)/);
  assert.match(source, /else process\.exit\(code \?\? 1\)/);
});
