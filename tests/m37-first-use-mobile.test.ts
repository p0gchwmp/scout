import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) { return readFile(new URL(path, import.meta.url), "utf8"); }

test("M37 provides an owner-only mobile-first Start Here workflow", async () => {
  const [page, css, home] = await Promise.all([
    source("../app/start/page.tsx"),
    source("../app/start/start.module.css"),
    source("../app/page.tsx"),
  ]);
  assert.match(page, /requireScoutPageOwner/);
  for (const path of ["/readiness", "/run", "/shortlist", "/applications", "/review", "/outcomes"]) assert.match(page, new RegExp(path));
  assert.match(page, /Employer-side submission and email sending remain manual/);
  assert.match(css, /@media\(max-width:850px\)/);
  assert.match(css, /position:fixed/);
  assert.match(home, /\["Start Here", "\/start"\]/);
  assert.doesNotMatch(page, /fetch\([^)]*(send|submit)/i);
});
