import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const doctor = fileURLToPath(new URL("./scout-doctor.mjs", import.meta.url));
const smoke = fileURLToPath(new URL("./scout-smoke.mjs", import.meta.url));

function run(label, script, args = []) {
  console.log(`\nScout ready: ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

function selfTest() {
  if (!doctor.endsWith("scout-doctor.mjs")) throw new Error("Doctor path self-test failed");
  if (!smoke.endsWith("scout-smoke.mjs")) throw new Error("Smoke path self-test failed");
  console.log("Scout ready self-test: OK (doctor -> local smoke, no external action stage)." );
}

const allowed = new Set(["--self-test"]);
for (const argument of process.argv.slice(2)) {
  if (!allowed.has(argument)) throw new Error(`Unknown Scout ready option: ${argument}`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

run("read-only doctor", doctor);
run("full local startup smoke", smoke);
console.log("\nScout ready: PASS. Start Scout with `npm run dev`, or seed the synthetic workflow with `npm run dev:demo`." );
