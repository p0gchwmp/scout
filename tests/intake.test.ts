import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseInternshipIntakePayload } from "../lib/scout/api-validation.ts";
import { JOB_INTAKE_CAPABILITIES, normalizeInternshipLead } from "../lib/scout/job-intake.ts";

test("internship intake stores links as leads without fetching or pretending they are snapshotted", async () => {
  const parsed = parseInternshipIntakePayload({
    url: "https://www.linkedin.com/jobs/view/123#tracking",
    company: "Acme",
    title: "Product Intern",
  });
  const lead = normalizeInternshipLead(parsed);
  assert.equal(lead.channel.id, "linkedin");
  assert.equal(lead.canonicalUrl, "https://www.linkedin.com/jobs/view/123");
  assert.equal(lead.snapshotRequired, true);
  assert.match(lead.nextStep, /official company or ATS posting/i);
  assert.throws(() => normalizeInternshipLead({ ...parsed, url: "http://localhost:3000/jobs/1" }), /HTTPS|private/i);
  assert.throws(() => normalizeInternshipLead({ ...parsed, url: "https://user:pass@example.com/jobs/1" }), /credentials/i);
  assert.deepEqual(JOB_INTAKE_CAPABILITIES, { storeLead: true, networkFetch: false, submit: false, send: false });

  const route = await readFile(new URL("../app/api/intake/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser/);
  assert.match(route, /requireSameOriginMutation/);
  assert.doesNotMatch(route, /\bfetch\s*\(/);
  assert.match(route, /currentSnapshotId:\s*null/);
});
