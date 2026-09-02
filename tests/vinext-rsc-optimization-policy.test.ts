import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../vite.config.ts", import.meta.url);

test("Vinext package stays out of dependency optimization and Windows client discovery is bounded", async () => {
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

  for (const dependency of [
    '"react"',
    '"react-dom"',
    '"react-dom/client"',
    '"react/jsx-runtime"',
    '"react/jsx-dev-runtime"',
  ]) {
    assert.match(config, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(config, /const isWindows = process\.platform === "win32"/);
  assert.match(
    config,
    /isWindows\s*\?\s*\{\s*noDiscovery:\s*true,\s*include:\s*WINDOWS_CLIENT_OPTIMIZE_INCLUDE/s,
  );
  assert.match(config, /rsc:\s*\{\s*optimizeDeps:\s*\{\s*exclude:\s*VINEXT_RSC_OPTIMIZE_EXCLUDE/);
  assert.match(config, /ssr:\s*\{\s*optimizeDeps:\s*\{\s*exclude:\s*VINEXT_RSC_OPTIMIZE_EXCLUDE/);
  assert.doesNotMatch(config, /rsc:\s*\{\s*optimizeDeps:\s*\{[^}]*noDiscovery/s);
  assert.doesNotMatch(config, /ssr:\s*\{\s*optimizeDeps:\s*\{[^}]*noDiscovery/s);
});
