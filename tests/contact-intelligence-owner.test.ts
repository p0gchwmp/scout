import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("contact intelligence workspace is owner-only and reachable from the dashboard", async () => {
  const page = await readFile(new URL("../app/contacts/page.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requireChatGPTUser\("\/contacts"\)/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(dashboard, /\["Contacts", "\/contacts"\]/);
});
