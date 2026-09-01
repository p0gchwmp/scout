import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) { return readFile(new URL(path, import.meta.url), "utf8"); }

test("M41 adds a mobile application action dock without adding submission behavior", async () => {
  const [page, css, workspace] = await Promise.all([
    source("../app/applications/page.tsx"),
    source("../app/applications/mobile-actions.module.css"),
    source("../app/applications/workspace-client.tsx"),
  ]);
  for (const href of ["/applications", "/shortlist", "/assist", "/review", "/outcomes"]) assert.match(page, new RegExp(href));
  assert.match(page, /requireScoutPageOwner/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /position:fixed/);
  assert.match(css, /grid-template-columns:repeat\(5/);
  assert.match(workspace, /This does not open, fill, click or submit the employer form/);
  assert.match(workspace, /Scout submission capability: disabled/);
  assert.doesNotMatch(page, /fetch\(/);
});
