import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localDiscoverySnapshot, verifyLocalDiscoveryEnvelope } from "../lib/scout/local-discovery-import.ts";

const secret = "a".repeat(64);
const observedAt = "2026-08-24T00:00:00.000Z";
const verifyAt = Date.parse("2026-08-24T00:05:00Z");

function signedPayload(value: unknown) {
  const payload = JSON.stringify(value);
  return { payload, signature: createHmac("sha256", secret).update(payload).digest("hex") };
}

function signed(leads: unknown[]) {
  return signedPayload({ schemaVersion: 1, observedAt, leads, failures: [] });
}

const greenhouseLead = {
  provider: "greenhouse", slug: "fourkites", company: "FourKites", companyDomain: "fourkites.com",
  sourceUrl: "https://job-boards.greenhouse.io/fourkites", focus: "product, operations, documentation",
  externalId: "123", canonicalUrl: "https://job-boards.greenhouse.io/fourkites/jobs/123",
  title: "Product Support - Intern", description: "Internship in Chennai, India", location: "Chennai, India",
  workplaceType: "unspecified", postedAt: "2026-08-24T00:00:00Z",
};

const ashbyLead = {
  provider: "ashby", slug: "flagright.com", company: "Flagright", companyDomain: "flagright.com",
  sourceUrl: "https://jobs.ashbyhq.com/flagright.com", focus: "global fintech, product operations, implementation, automation, QA",
  externalId: "cdc0b71f-fb24-49bf-babe-de63bdaacb7e",
  canonicalUrl: "https://jobs.ashbyhq.com/flagright.com/cdc0b71f-fb24-49bf-babe-de63bdaacb7e",
  title: "Product Operations Intern", description: "Internship supporting implementations, workflows and QA.", location: "Remote",
  workplaceType: "remote", postedAt: "2026-08-20T00:00:00Z",
};

const workableLead = {
  provider: "workable", slug: "2070health", company: "2070Health", companyDomain: "2070health.com",
  sourceUrl: "https://apply.workable.com/2070health/", focus: "India health-tech, D2C operations, GTM, business",
  externalId: "9236226E92", canonicalUrl: "https://apply.workable.com/2070health/j/9236226E92/",
  title: "Go-To-Market Intern", description: "Internship supporting D2C store operations and catalogue workflows.", location: "Gurugram, India",
  workplaceType: "on-site", postedAt: "2026-08-22",
};

const smartRecruitersLead = {
  provider: "smartrecruiters", slug: "BoschGroup", company: "Bosch Group", companyDomain: "bosch.com",
  sourceUrl: "https://careers.smartrecruiters.com/BoschGroup", focus: "global and India business analysis, product, operations, technology",
  externalId: "744000108155586",
  canonicalUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000108155586--bd-business-analyst-intern",
  title: "Business Analyst Intern", description: "Student internship supporting workflow analysis and product documentation.", location: "Ho Chi Minh City, VN",
  workplaceType: "on-site", postedAt: "2026-08-01T00:00:00Z",
};

test("local discovery import verifies HMAC, catalog identity and internship policy", async () => {
  const verified = await verifyLocalDiscoveryEnvelope(signed([greenhouseLead]), secret, verifyAt);
  assert.equal(verified.leads.length, 1);
  assert.equal(verified.leads[0].company, "FourKites");
  const snapshot = await localDiscoverySnapshot(verified.leads[0]);
  assert.ok(snapshot);
  assert.equal(snapshot.snapshot.externalId, "123");
  assert.match(snapshot.contentHash, /^[a-f0-9]{64}$/);
});

test("local discovery import accepts legitimate internships outside India and remote", async () => {
  const overseas = {
    ...greenhouseLead,
    externalId: "456",
    canonicalUrl: "https://job-boards.greenhouse.io/fourkites/jobs/456",
    title: "Business Operations Intern",
    description: "Internship based in London",
    location: "London, United Kingdom",
  };
  const verified = await verifyLocalDiscoveryEnvelope(signed([overseas]), secret, verifyAt);
  assert.equal(verified.leads.length, 1);
  assert.equal(verified.leads[0].location, "London, United Kingdom");
});

test("local discovery import rejects tampering, arbitrary sources and stale payloads", async () => {
  const envelope = signed([greenhouseLead]);
  await assert.rejects(() => verifyLocalDiscoveryEnvelope({ ...envelope, payload: envelope.payload.replace("FourKites", "EvilCorp") }, secret, verifyAt), /signature verification failed/);
  const arbitrary = { ...greenhouseLead, slug: "not-controlled", canonicalUrl: "https://job-boards.greenhouse.io/not-controlled/jobs/123" };
  await assert.rejects(() => verifyLocalDiscoveryEnvelope(signed([arbitrary]), secret, verifyAt), /not controlled/);
  const nonInternship = { ...greenhouseLead, title: "Senior Product Manager", description: "Full-time role" };
  await assert.rejects(() => verifyLocalDiscoveryEnvelope(signed([nonInternship]), secret, verifyAt), /internship policy/);
  await assert.rejects(() => verifyLocalDiscoveryEnvelope(envelope, secret, Date.parse("2026-08-24T01:00:00Z")), /stale/);
});

test("Lever bridge observations produce immutable snapshots after provider support is enabled", async () => {
  const lever = { ...greenhouseLead,
    provider: "lever", slug: "paytm", company: "Paytm", companyDomain: "paytm.com",
    sourceUrl: "https://jobs.lever.co/paytm", focus: "product, fintech, operations", externalId: "abc-123",
    canonicalUrl: "https://jobs.lever.co/paytm/abc-123", title: "Product Management Intern", location: "Noida, India",
  };
  const verified = await verifyLocalDiscoveryEnvelope(signed([lever]), secret, verifyAt);
  assert.equal(verified.leads[0].provider, "lever");
  const snapshot = await localDiscoverySnapshot(verified.leads[0]);
  assert.ok(snapshot);
  assert.equal(snapshot.snapshot.sourceProvider, "lever");
  assert.equal(snapshot.snapshot.externalId, "abc-123");
});

test("Ashby, Workable and SmartRecruiters leads cross the signed discovery boundary", async () => {
  const verified = await verifyLocalDiscoveryEnvelope(signed([ashbyLead, workableLead, smartRecruitersLead]), secret, verifyAt);
  assert.deepEqual(verified.leads.map((lead) => lead.provider), ["ashby", "workable", "smartrecruiters"]);
  assert.deepEqual(verified.leads.map((lead) => lead.externalId), [
    "cdc0b71f-fb24-49bf-babe-de63bdaacb7e",
    "9236226E92",
    "744000108155586",
  ]);
});

test("schema v2 observations accept the complete controlled five-provider catalog", async () => {
  const catalog = JSON.parse(await readFile(new URL("../config/discovery-sources.json", import.meta.url), "utf8")) as Array<{ provider: string; slug: string }>;
  const envelope = signedPayload({
    schemaVersion: 2,
    observedAt,
    leads: [],
    failures: [],
    sources: catalog.map((source) => ({ provider: source.provider, slug: source.slug, status: "completed", internshipCount: 0, reason: null })),
  });
  const verified = await verifyLocalDiscoveryEnvelope(envelope, secret, verifyAt);
  assert.equal(verified.sources.length, catalog.length);
  assert.deepEqual(
    [...new Set(verified.sources.map((source) => source.provider))].sort(),
    ["ashby", "greenhouse", "lever", "smartrecruiters", "workable"],
  );
});

test("non-Greenhouse providers cannot spoof canonical posting hosts", async () => {
  for (const lead of [ashbyLead, workableLead, smartRecruitersLead]) {
    const original = new URL(lead.canonicalUrl);
    const spoofed = { ...lead, canonicalUrl: `https://example.com${original.pathname}` };
    await assert.rejects(() => verifyLocalDiscoveryEnvelope(signed([spoofed]), secret, verifyAt), /canonical URL does not match its controlled source/);
  }
});
