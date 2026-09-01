import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { WorkablePublicAdapter } from "../lib/adapters.ts";
import { validateWorkableEvidenceUrl } from "../lib/scout/contact-extraction.ts";
import { verifyLocalDiscoveryEnvelope } from "../lib/scout/local-discovery-import.ts";

const externalId = "9236226E92";
const currentShortlink = `https://apply.workable.com/j/${externalId}`;
const legacySlugged = `https://apply.workable.com/2070health/j/${externalId}/`;

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

test("Workable discovery prefers the documented exact shortlink over the direct application form", async () => {
  const jobs = await withFetch((async (input) => {
    const url = new URL(String(input));
    assert.equal(url.href, "https://www.workable.com/api/accounts/2070health?details=true");
    return Response.json({
      name: "2070Health",
      jobs: [{
        shortcode: externalId,
        title: "Go-To-Market Intern",
        city: "Gurugram",
        country: "India",
        published_on: "2026-08-22",
        shortlink: currentShortlink,
        application_url: `${currentShortlink}/apply`,
        description: "Internship supporting D2C store operations and catalogue workflows.",
        workplace_type: "on_site",
      }],
    });
  }) as typeof fetch, () => new WorkablePublicAdapter().discover("2070health"));

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, externalId);
  assert.equal(jobs[0].canonicalUrl, currentShortlink);
});

test("registered Workable evidence accepts current and legacy exact job-page forms only", () => {
  assert.equal(validateWorkableEvidenceUrl(currentShortlink, "2070health", externalId).href, currentShortlink);
  assert.equal(validateWorkableEvidenceUrl(legacySlugged, "2070health", externalId).href, legacySlugged);
  assert.throws(() => validateWorkableEvidenceUrl(`${currentShortlink}/apply`, "2070health", externalId), /does not match the registered source/);
  assert.throws(() => validateWorkableEvidenceUrl("https://example.com/j/9236226E92", "2070health", externalId), /does not match the registered source/);
  assert.throws(() => validateWorkableEvidenceUrl("https://apply.workable.com/j/WRONG123", "2070health", externalId), /does not match the registered source/);
});

test("signed local discovery binds a slugless Workable shortlink to its controlled source metadata", async () => {
  const observedAt = "2026-09-02T00:00:00.000Z";
  const secret = "b".repeat(64);
  const lead = {
    provider: "workable",
    slug: "2070health",
    company: "2070Health",
    companyDomain: "2070health.com",
    sourceUrl: "https://apply.workable.com/2070health/",
    focus: "India health-tech, D2C operations, GTM, business",
    externalId,
    canonicalUrl: currentShortlink,
    title: "Go-To-Market Intern",
    description: "Internship supporting D2C store operations and catalogue workflows.",
    location: "Gurugram, India",
    workplaceType: "on-site",
    postedAt: "2026-08-22",
  } as const;
  const payload = JSON.stringify({ schemaVersion: 1, observedAt, leads: [lead], failures: [] });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  const verified = await verifyLocalDiscoveryEnvelope({ payload, signature }, secret, Date.parse("2026-09-02T00:05:00.000Z"));
  assert.equal(verified.leads[0].slug, "2070health");
  assert.equal(verified.leads[0].canonicalUrl, currentShortlink);

  const wrongPayload = JSON.stringify({ schemaVersion: 1, observedAt, leads: [{ ...lead, canonicalUrl: "https://apply.workable.com/j/WRONG123" }], failures: [] });
  const wrongSignature = createHmac("sha256", secret).update(wrongPayload).digest("hex");
  await assert.rejects(
    () => verifyLocalDiscoveryEnvelope({ payload: wrongPayload, signature: wrongSignature }, secret, Date.parse("2026-09-02T00:05:00.000Z")),
    /Workable canonical URL does not match its controlled source/,
  );
});
