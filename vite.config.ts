import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { buildLocalDevWorkerBindings } from "./lib/scout/local-dev-auth";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// Vinext's App Router client shims and virtual-module graph must keep their
// original module identity for @vitejs/plugin-rsc. On Windows with npm-installed
// Vinext, optimizing only part of the package can still pull Vinext internals
// into hashed .vite/deps chunks and terminate the dev server after optimizer
// bundling. Exclude the whole Vinext package plus the explicit shim paths in all
// dev environments. Dependency optimization remains enabled for everything else.
const VINEXT_RSC_OPTIMIZE_EXCLUDE = [
  "vinext",
  "vinext/shims/layout-segment-context",
  "vinext/shims/slot",
  "vinext/shims/link",
  "vinext/shims/navigation",
  "vinext/shims/form",
  "vinext/shims/script",
  "vinext/shims/error-boundary",
  "vinext/shims/client-hook-error",
  "vinext/dist/shims/internal/app-prefetch-fetch-queue.js",
];

// Vite 8 supports disabling automatic dependency discovery while still
// explicitly optimizing CommonJS-ish browser essentials. Scout only needs this
// escape hatch for the Windows client environment: the RSC/SSR optimizers start
// successfully there, while the client scanner can terminate the Node process
// before it even begins bundling. Keep the list intentionally small so this does
// not become a second dependency graph that drifts from package.json.
const WINDOWS_CLIENT_OPTIMIZE_INCLUDE = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

const isWindows = process.platform === "win32";
const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Only the local `vite serve` runtime receives these bindings. They are not
  // embedded into production builds or deployments.
  const localWorkerVars = buildLocalDevWorkerBindings(
    command,
    mode,
    process.env,
  );

  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: localWorkerVars,
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // Local Scout should never silently bind to a LAN/public interface. An
    // explicit IPv4 loopback also avoids localhost resolving to ::1 in CI while
    // readiness probes use 127.0.0.1.
    server: {
      host: "127.0.0.1",
      port: 3000,
      strictPort: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    optimizeDeps: {
      exclude: VINEXT_RSC_OPTIMIZE_EXCLUDE,
      ...(isWindows
        ? {
            noDiscovery: true,
            include: WINDOWS_CLIENT_OPTIMIZE_INCLUDE,
          }
        : {}),
    },
    environments: {
      rsc: {
        optimizeDeps: {
          exclude: VINEXT_RSC_OPTIMIZE_EXCLUDE,
        },
      },
      ssr: {
        optimizeDeps: {
          exclude: VINEXT_RSC_OPTIMIZE_EXCLUDE,
        },
      },
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
