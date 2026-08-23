import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = { ...process.env };
const keys = ["SCOUT_LOCAL_DEV_AUTH", "SCOUT_LOCAL_DEV_USER_ID", "SCOUT_OWNER_USER_ID"];
const configured = keys.filter((key) => typeof env[key] === "string" && env[key].trim());

// A fresh local shell should be able to run Scout without repeatedly exporting
// three development-only variables. We only synthesize defaults when none of
// the auth variables are present. Partial or mismatched configuration remains
// fail-closed in buildLocalDevWorkerBindings().
if (configured.length === 0) {
  env.SCOUT_LOCAL_DEV_AUTH = "1";
  env.SCOUT_LOCAL_DEV_USER_ID = "scout-local-owner";
  env.SCOUT_OWNER_USER_ID = "scout-local-owner";
  console.log("Scout local dev auth: loopback-only owner enabled for this dev process.");
}

// Spawn Node directly on Vinext's JS CLI instead of spawning npm.cmd. Recent
// Node versions on Windows can reject .cmd execution through child_process
// with EINVAL depending on shell/quoting behavior. Running the installed CLI
// with the current Node executable is cross-platform and avoids that layer.
const vinextCli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const child = spawn(process.execPath, [vinextCli, "dev"], {
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("Unable to start Vinext:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
