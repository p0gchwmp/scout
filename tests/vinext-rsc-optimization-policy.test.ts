import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../vite.config.ts", import.meta.url);

test("Vinext package and RSC client shims stay out of Vite dependency optimization", async () => {
  const config = await readFile(configUrl, "utf8");

  for (const dependency of [
    '"vinext"',
    "vinext/shims/link",
    "vinext/shims/navigation",
    "vinext/shims/layout-segment-context",
    "vinext/shims/slot",
    "vinext/dist/shims/internal/app-prefetch-fetch-queue.js",
  ]) {
    assert.match(config, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(config, /optimizeDeps:\s*\{\s*exclude:\s*VINEXT_RSC_OPTIMIZE_EXCLUDE/);
  assert.match(config, /rsc:\s*\{\s*optimizeDeps:\s*\{\s*exclude:\s*VINEXT_RSC_OPTIMIZE_EXCLUDE/);
  assert.match(config, /ssr:\s*\{\s*optimizeDeps:\s*\{\s*exclude:\s*VINEXT_RSC_OPTIMIZE_EXCLUDE/);
  assert.doesNotMatch(config, /optimizeDeps:\s*\{[^}]*noDiscovery:\s*true/s);
});
