import { execFileSync } from "node:child_process";

const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
  encoding: "utf8",
}).trim();

if (output) {
  console.error("Scout release verification requires a clean worktree. Unexpected tracked or untracked changes:\n" + output);
  process.exit(1);
}
