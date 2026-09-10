import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RESUME_IMPORT_PROFILE_KINDS, parseResumeImportPayload } from "../lib/scout/resume-import.ts";

const claimsOnlyPayload = {
  schemaVersion: 1,
  resumeReference: "Ryan_Vivek_Mahajan_Resume_2026_AI_Transparent_v2(1).pdf",
  acknowledgeDraftOnly: true,
  profile: [],
  claims: [
    {
      statement: "I am pursuing a B.S. in Management and Public Policy with expected graduation in 2029.",
      evidence: "User-approved resume: B.S. Management and Public Policy | Expected 2029.",
    },
  ],
} as const;

test("resume import accepts claims-only payloads without profile evidence", () => {
  const parsed = parseResumeImportPayload(claimsOnlyPayload);

  assert.deepEqual(parsed.profile, []);
  assert.equal(parsed.claims.length, 1);
  assert.equal(parsed.claims[0].statement, claimsOnlyPayload.claims[0].statement);
  assert.equal(parsed.acknowledgeDraftOnly, true);
});

test("resume import still caps optional profile evidence at the supported kinds", () => {
  const tooManyProfileFields = Array.from({ length: RESUME_IMPORT_PROFILE_KINDS.length + 1 }, (_, index) => ({
    kind: "full_name",
    claim: `Ryan ${index}`,
    evidence: "test evidence",
  }));

  assert.throws(
    () => parseResumeImportPayload({ ...claimsOnlyPayload, profile: tooManyProfileFields }),
    new RegExp(`Resume import profile must contain 0-${RESUME_IMPORT_PROFILE_KINDS.length} fields`),
  );
});

test("claims-only import route gates every profile mutation on payload.profile and batches claim inserts", async () => {
  const route = await readFile(new URL("../app/api/resume-import/route.ts", import.meta.url), "utf8");

  assert.match(route, /const newProfileRows = payload\.profile\.filter/);
  assert.match(route, /const profileUpdates = payload\.profile\.filter/);
  assert.match(route, /if \(newProfileRows\.length\)/);
  assert.match(route, /for \(const incoming of profileUpdates\)/);
  assert.match(route, /const newClaimRows = payload\.claims\.flatMap/);
  assert.match(route, /status: "draft" as const/);
  assert.match(route, /await db\.batch\(newClaimRows\.map/);
  assert.doesNotMatch(route, /db\.insert\(candidateClaims\)\.values\(newClaimRows\)/);
});
