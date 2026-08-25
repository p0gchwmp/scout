import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("source health workspace is owner-only and diagnostics stay read-only", async () => {
  const [page, client, worker] = await Promise.all([
    readFile(new URL("../app/sources/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sources/source-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /requireChatGPTUser\("\/sources"\)/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(worker, /"\/sources"/);
  assert.match(client, /fetch\("\/api\/sources", \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
  assert.match(client, /never auto-removes or auto-disables/i);
  assert.match(client, /temporary ATS failure does not close jobs, disable a source, or authorize broader scraping/i);
});

test("sources API merges the controlled catalog with persisted health and job evidence", async () => {
  const route = await readFile(new URL("../app/api/sources/route.ts", import.meta.url), "utf8");
  assert.match(route, /discoveryCatalog/);
  assert.match(route, /assessSourceHealth/);
  assert.match(route, /jobs\.sourceRegistryId/);
  assert.match(route, /syncRuns\.error/);
  assert.match(route, /idempotencyKey\.startsWith\("local-health:"\)/);
  assert.match(route, /catalogEntry: true/);
  assert.match(route, /catalogEntry: false/);
  assert.doesNotMatch(route, /export async function (?:POST|PATCH|PUT|DELETE)/);
});

test("verified catalog expansion keeps both India context and global internship coverage", async () => {
  const catalog = JSON.parse(await readFile(new URL("../config/discovery-sources.json", import.meta.url), "utf8")) as Array<{ provider: string; slug: string; company: string; focus: string }>;
  const bySlug = new Map(catalog.map((source) => [source.slug, source]));
  for (const slug of ["stable-money1", "aleph", "sitetracker", "getwingapp", "sezzleinternships"]) assert.ok(bySlug.has(slug), slug);
  assert.match(bySlug.get("stable-money1")?.focus ?? "", /India finance/i);
  assert.match(bySlug.get("getwingapp")?.focus ?? "", /global remote/i);
  assert.ok(catalog.length >= 23);
  assert.ok(catalog.every((source) => source.provider === "greenhouse" || source.provider === "lever"), "this catalog stays compatible with local Scout discovery");
});
