import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("shortlist surfaces quality as a separate review axis without replacing fit ranking", async () => {
  const shortlist = await readFile(new URL("../app/shortlist/shortlist-client.tsx", import.meta.url), "utf8");
  assert.match(shortlist, /assessOpportunityQuality\(/);
  assert.match(shortlist, /"Quality review"/);
  assert.match(shortlist, /quality\.tier !== "strong_evidence"/);
  assert.match(shortlist, /Opportunity quality · \{quality\.score\}\/100/);
  assert.match(shortlist, /if \(right\.assessment\.score !== left\.assessment\.score\) return right\.assessment\.score - left\.assessment\.score/);
  assert.doesNotMatch(shortlist, /right\.quality\.score\s*-\s*left\.quality\.score/);
  assert.match(shortlist, /Opportunity quality remains a separate evidence axis/);
});
