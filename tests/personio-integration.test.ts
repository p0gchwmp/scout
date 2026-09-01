import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validatePersonioEvidenceUrl } from "../lib/scout/contact-extraction.ts";

test("Personio evidence is bound to the registered tenant and numeric position id", () => {
  assert.equal(validatePersonioEvidenceUrl("https://acme.jobs.personio.de/job/4103", "acme", "4103").href, "https://acme.jobs.personio.de/job/4103");
  assert.throws(() => validatePersonioEvidenceUrl("https://other.jobs.personio.de/job/4103", "acme", "4103"));
  assert.throws(() => validatePersonioEvidenceUrl("https://acme.jobs.personio.de/job/9999", "acme", "4103"));
});

test("Personio is wired into registered discovery without adding send/apply behavior", async () => {
  const registered = await readFile(new URL("../lib/scout/greenhouse.ts", import.meta.url), "utf8");
  const discovery = await readFile(new URL("../lib/scout/lead-discovery.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(registered, /case "personio"/);
  assert.match(discovery, /case "personio"/);
  assert.match(schema, /\| "personio"/);
  assert.doesNotMatch(registered, /submitApplication\s*:\s*true|sendEmail\s*:\s*true/);
});
