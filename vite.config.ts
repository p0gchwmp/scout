import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { buildLocalDevWorkerBindings } from "./lib/scout/local-dev-auth";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

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

const WINDOWS_CLIENT_OPTIMIZE_INCLUDE = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

const isWindows = process.platform === "win32";
const isNodeTarget = process.env.SCOUT_RUNTIME_TARGET?.trim().toLowerCase() === "node";
const { d1, r2 } = hostingConfig;
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const nodeCloudflareEnvShim = fileURLToPath(new URL("./lib/scout/node-cloudflare-env.ts", import.meta.url));

export default defineConfig(async ({ command, mode }) => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const common = {
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
  };

  if (isNodeTarget) {
    return {
      ...common,
      resolve: {
        alias: {
          "cloudflare:workers": nodeCloudflareEnvShim,
        },
      },
      plugins: [vinext()],
    };
  }

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

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    ...common,
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
