import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EVIDENCE_INTELLIGENCE_CAPABILITIES } from "../lib/scout/evidence-intelligence.ts";

test("evidence intelligence is owner-only, reachable, and read-only", async () => {
  const [page, client, worker, root] = await Promise.all([
    readFile(new URL("../app/evidence/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/evidence/evidence-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /requireChatGPTUser\("\/evidence"\)/);
  assert.match(page, /requireScoutPageOwner\(/);
  assert.match(worker, /OWNER_PAGE_PATHS\.add\("\/evidence"\)/);
  assert.ok(root.includes('["Evidence", "/evidence"]'));

  assert.match(client, /fetch\("\/api\/claims"\)/);
  assert.match(client, /fetch\("\/api\/profile"\)/);
  assert.match(client, /fetch\("\/api\/jobs"\)/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
  assert.doesNotMatch(client, /fetch\([^)]*\/api\/(?:claims|profile)[^)]*,\s*\{/s);

  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.readOnlyDiagnostics, true);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.approvedClaimsOnlyForCoverage, true);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.autoMergeClaims, false);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.autoApproveClaims, false);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.inferMissingExperience, false);
  assert.equal(EVIDENCE_INTELLIGENCE_CAPABILITIES.rewriteApprovedClaims, false);
});

test("evidence workspace explains gaps as evidence gaps and keeps approved claims immutable", async () => {
  const [client, css] = await Promise.all([
    readFile(new URL("../app/evidence/evidence-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/evidence/evidence.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /Scout lacks approved evidence/);
  assert.match(client, /Approved claims are immutable/);
  assert.match(client, /Review; never auto-merge/);
  assert.match(css, /@media \(max-width: 720px\)/);
});
