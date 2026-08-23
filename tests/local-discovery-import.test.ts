import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { localDiscoverySnapshot, verifyLocalDiscoveryEnvelope } from "../lib/scout/local-discovery-import.ts";

const secret = "a".repeat(64);

function signed(leads: unknown[]) {
  const payload = JSON.stringify({ schemaVersion: 1, observedAt: "2026-08-24T00:00:00.000Z", leads, failures: [] });
  return { payload, signature: createHmac("sha256", secret).update(payload).digest("hex") };
}

const greenhouseLead = {
  provider: "greenhouse", slug: "fourkites", company: "FourKites", companyDomain: "fourkites.com",
  sourceUrl: "https://job-boards.greenhouse.io/fourkites", focus: "product, operations, documentation",
  externalId: "123", canonicalUrl: "https://job-boards.greenhouse.io/fourkites/jobs/123",
  title: "Product Support - Intern", description: "Internship in Chennai, India", location: "Chennai, India",
  workplaceType: "unspecified", postedAt: "2026-08-24T00:00:00Z",
};

test("local discovery import verifies HMAC, catalog identity and internship policy", async () => {
  const verified = await verifyLocalDiscoveryEnvelope(signed([greenhouseLead]), secret, Date.parse("2026-08-24T00:05:00Z"));
  assert.equal(verified.leads.length, 1);
  assert.equal(verified.leads[0].company, "FourKites");
  const snapshot = await localDiscoverySnapshot(verified.leads[0]);
  assert.ok(snapshot);
  assert.equal(snapshot.snapshot.externalId, "123");
  assert.match(snapshot.contentHash, /^[a-f0-9]{64}$/);
});

test("local discovery import rejects tampering, arbitrary sources and stale payloads", async () => {
  const envelope = signed([greenhouseLead]);
  await assert.rejects(() => verifyLocalDiscoveryEnvelope({ ...envelope, payload: envelope.payload.replace("FourKites", "EvilCorp") }, secret, Date.parse("2026-08-24T00:05:00Z")), /signature verification failed/);
  const arbitrary = { ...greenhouseLead, slug: "not-controlled", canonicalUrl: "https://job-boards.greenhouse.io/not-controlled/jobs/123" };
  await assert.rejects(() => verifyLocalDiscoveryEnvelope(signed([arbitrary]), secret, Date.parse("2026-08-24T00:05:00Z")), /not controlled/);
  await assert.rejects(() => verifyLocalDiscoveryEnvelope(envelope, secret, Date.parse("2026-08-24T01:00:00Z")), /stale/);
});

test("Lever bridge observations remain non-snapshot leads until Lever persistence is added", async () => {
  const lever = { ...greenhouseLead,
    provider: "lever", slug: "paytm", company: "Paytm", companyDomain: "paytm.com",
    sourceUrl: "https://jobs.lever.co/paytm", focus: "product, fintech, operations", externalId: "abc-123",
    canonicalUrl: "https://jobs.lever.co/paytm/abc-123", title: "Product Management Intern", location: "Noida, India",
  };
  const verified = await verifyLocalDiscoveryEnvelope(signed([lever]), secret, Date.parse("2026-08-24T00:05:00Z"));
  assert.equal(verified.leads[0].provider, "lever");
  assert.equal(await localDiscoverySnapshot(verified.leads[0]), null);
});
