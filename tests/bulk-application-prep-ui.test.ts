import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard bulk-prepares only saved active roles and keeps history out of the default queue", async () => {
  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /applicationScope.*useState<"Saved" \| "All">\("Saved"\)/);
  assert.match(dashboard, /job\.state === "saved" && job\.lifecycleState === "active"/);
  assert.match(dashboard, /Promise\.allSettled\(preparableSavedJobs\.map/);
  assert.match(dashboard, /Prepare saved \(\{preparableSavedJobs\.length\}\)/);
  assert.match(dashboard, /No applications were submitted/);
  assert.match(dashboard, /Historical packets are preserved but hidden by default/);
});

test("application queue renders the actual preparation packet keys", async () => {
  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /packet\.verifiedProfileKeys/);
  assert.match(dashboard, /packet\.alwaysConfirmPerApplication/);
  assert.match(dashboard, /packet\.availability/);
  assert.match(dashboard, /channel\.label/);
  assert.match(dashboard, /channel\.note/);
});
