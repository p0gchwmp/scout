import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const vinextCli = resolve(root, "node_modules", "vinext", "dist", "cli.js");
const result = spawnSync(process.execPath, [vinextCli, "build"], {
  cwd: root,
  env: {
    ...process.env,
    SCOUT_RUNTIME_TARGET: "node",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
