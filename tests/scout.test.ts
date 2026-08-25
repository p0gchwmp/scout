import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { requireSameOriginMutation, requireScoutApiUser } from "../app/scout-api.ts";
import {
  parseClaimCreatePayload,
  parseClaimMutationPayload,
  parseContactExtractionPayload,
  parseContactReviewPayload,
  parseJobMutationPayload,
  parseOutreachCreatePayload,
  parseOutreachMutationPayload,
  parseSyncPayload,
  parseProfileUpsertPayload,
  parseProfileReviewPayload,
  parseApplicationPreparePayload,
} from "../lib/scout/api-validation.ts";
import { approveClaim, editClaim } from "../lib/scout/claims.ts";
import {
  extractPublishedBusinessEmails,
  validateGreenhouseEvidenceUrl,
} from "../lib/scout/contact-extraction.ts";
import {
  OUTREACH_CAPABILITIES,
  approveDraft,
  hashDraftBody,
  renderOutreachDraft,
} from "../lib/scout/outreach.ts";
import { evaluateResumeAlignment } from "../lib/scout/resume-alignment.ts";
import { classifyApplicationUrl } from "../lib/scout/application-sites.ts";
import { APPLICATION_PREP_CAPABILITIES, buildApplicationPreparation } from "../lib/scout/application-prep.ts";
import { gmailComposeUrl, parseOutreachDraftForEmail } from "../lib/scout/gmail-compose.ts";
import { synchronizeSource, type ScoutSyncStore } from "../lib/scout/sync.ts";
import type {
  CompanySource,
  JobRecord,
  NormalizedJobSnapshot,
  SyncRun,
} from "../lib/scout/types.ts";

const source: CompanySource = {
  id: "src_acme",
  provider: "greenhouse",
  companyName: "Acme",
  boardToken: "acme",
  companyDomain: "acme.example",
  careersUrl: "https://careers.acme.example/contact",
  enabled: true,
};

const incoming = (externalId: string, title = "Product Intern"): NormalizedJobSnapshot => ({
  sourceProvider: "greenhouse",
  externalId,
  canonicalUrl: `https://job-boards.greenhouse.io/acme/jobs/${externalId}`,
  company: "Acme",
  title,
  description: "Student role using SQL and research",
  location: "Remote",
  workplaceType: "remote",
  score: 88,
  scoreExplanation: ["Role family match"],
  eligibilityRisks: [],
  postedAt: "2026-08-12T00:00:00.000Z",
});

class MemoryStore implements ScoutSyncStore {
  readonly sources = new Map([[source.id, source]]);
  readonly runs: SyncRun[] = [];
  readonly jobs: JobRecord[] = [];
  adapterCalls = 0;

  async getSource(id: string) { return this.sources.get(id); }
  async findRun(sourceId: string, key: string) {
    return this.runs.find((run) => run.sourceId === sourceId && run.idempotencyKey === key);
  }
  async createRun(run: SyncRun) {
    const sameKey = await this.findRun(run.sourceId, run.idempotencyKey);
    if (sameKey) return sameKey;
    if (this.runs.some((item) => item.sourceId === run.sourceId && item.status === "running")) {
      throw new Error("A sync is already running for this source");
    }
    this.runs.push({ ...run });
    return run;
  }
  async listJobs(sourceId: string) { return this.jobs.filter((job) => job.sourceId === sourceId).map((job) => ({ ...job })); }
  async persistPlan(run: SyncRun, plan: { jobs: JobRecord[]; created: number; updated: number; unchanged: number; closed: number }) {
    this.jobs.splice(0, this.jobs.length, ...plan.jobs.map((job) => ({ ...job })));
    const stored = this.runs.find((item) => item.id === run.id);
    if (!stored) throw new Error("run missing");
    Object.assign(stored, {
      status: "completed",
      discoveredCount: plan.created + plan.updated + plan.unchanged,
      createdCount: plan.created,
      updatedCount: plan.updated,
      unchangedCount: plan.unchanged,
      closedCount: plan.closed,
      completedAt: run.observedAt,
    });
    return this.runs.find((item) => item.id === run.id)!;
  }
  async failRun(run: SyncRun, message: string) {
    const stored = this.runs.find((item) => item.id === run.id);
    if (!stored) throw new Error("run missing");
    Object.assign(stored, { status: "failed", error: message });
  }
}

test("sync idempotency returns the persisted run without fetching twice", async () => {
  const store = new MemoryStore();
  const discover = async () => { store.adapterCalls += 1; return { jobs: [incoming("1")], complete: true as const }; };
  const options = { sourceId: source.id, idempotencyKey: "daily-2026-08-15", observedAt: "2026-08-15T08:00:00.000Z", idFactory: () => "run-1" };

  const first = await synchronizeSource(store, discover, options);
  const second = await synchronizeSource(store, discover, options);

  assert.equal(first.id, second.id);
  assert.equal(first.createdCount, 1);
  assert.equal(store.adapterCalls, 1);
  assert.equal(store.runs.length, 1);
  assert.equal(store.jobs.length, 1);
  assert.equal(store.jobs[0].snapshots.length, 1);
});

test("sync requires repeated non-suspicious absence before closing and reopens returned identity", async () => {
  const store = new MemoryStore();
  let payload = [incoming("1"), incoming("2")];
  const discover = async () => ({ jobs: payload, complete: true as const });

  await synchronizeSource(store, discover, { sourceId: source.id, idempotencyKey: "one", observedAt: "2026-08-15T08:00:00.000Z", idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  payload = [incoming("1", "Senior Product Intern")];
  const second = await synchronizeSource(store, discover, { sourceId: source.id, idempotencyKey: "two", observedAt: "2026-08-16T08:00:00.000Z", idFactory: (() => { let n = 20; return () => `id-${++n}`; })() });

  const changed = store.jobs.find((job) => job.externalId === "1")!;
  const missing = store.jobs.find((job) => job.externalId === "2")!;
  assert.equal(second.updatedCount, 1);
  assert.equal(second.closedCount, 0);
  assert.equal(changed.snapshots.length, 2);
  assert.equal(changed.currentSnapshot.title, "Senior Product Intern");
  assert.equal(missing.lifecycleState, "active");
  assert.equal(missing.missingCount, 1);

  const third = await synchronizeSource(store, discover, { sourceId: source.id, idempotencyKey: "three", observedAt: "2026-08-17T08:00:00.000Z", idFactory: (() => { let n = 40; return () => `id-${++n}`; })() });
  assert.equal(third.closedCount, 1);
  assert.equal(store.jobs.find((job) => job.externalId === "2")!.lifecycleState, "closed");

  payload = [incoming("2")];
  await synchronizeSource(store, discover, { sourceId: source.id, idempotencyKey: "four", observedAt: "2026-08-18T08:00:00.000Z", idFactory: (() => { let n = 60; return () => `id-${++n}`; })() });
  assert.equal(store.jobs.find((job) => job.externalId === "2")!.lifecycleState, "active");
  assert.equal(store.jobs.find((job) => job.externalId === "2")!.missingCount, 0);
  assert.equal(store.jobs.find((job) => job.externalId === "2")!.snapshots.length, 1);
});

test("failed, incomplete, empty, and suspicious discovery cannot mass-close jobs", async () => {
  const store = new MemoryStore();
  const tenJobs = Array.from({ length: 10 }, (_, index) => incoming(String(index + 1)));
  await synchronizeSource(store, async () => ({ jobs: tenJobs, complete: true }), {
    sourceId: source.id, idempotencyKey: "seed", observedAt: "2026-08-15T00:00:00.000Z",
    idFactory: (() => { let n = 100; return () => `seed-${++n}`; })(),
  });

  await assert.rejects(() => synchronizeSource(store, async () => { throw new Error("upstream failed"); }, {
    sourceId: source.id, idempotencyKey: "failed", observedAt: "2026-08-16T00:00:00.000Z",
  }), /upstream failed/);
  assert.equal(store.jobs.filter((job) => job.lifecycleState === "active").length, 10);

  await synchronizeSource(store, async () => ({ jobs: [], complete: true }), {
    sourceId: source.id, idempotencyKey: "empty", observedAt: "2026-08-17T00:00:00.000Z",
  });
  await synchronizeSource(store, async () => ({ jobs: [tenJobs[0]], complete: true }), {
    sourceId: source.id, idempotencyKey: "suspicious", observedAt: "2026-08-18T00:00:00.000Z",
  });
  await synchronizeSource(store, async () => ({ jobs: tenJobs.slice(0, 5), complete: false }), {
    sourceId: source.id, idempotencyKey: "partial", observedAt: "2026-08-19T00:00:00.000Z",
  });
  assert.equal(store.jobs.filter((job) => job.lifecycleState === "active").length, 10);
  assert.ok(store.jobs.every((job) => job.missingCount === 0));
});

test("A to B to A snapshot reversion reuses a real immutable snapshot", async () => {
  const store = new MemoryStore();
  let payload = [incoming("123", "A")];
  const discover = async () => ({ jobs: payload, complete: true as const });
  await synchronizeSource(store, discover, { sourceId: source.id, idempotencyKey: "aaa", observedAt: "2026-08-15T00:00:00.000Z" });
  const firstSnapshotId = store.jobs[0].currentSnapshot.id;
  payload = [incoming("123", "B")];
  await synchronizeSource(store, discover, { sourceId: source.id, idempotencyKey: "bbb", observedAt: "2026-08-16T00:00:00.000Z" });
  payload = [incoming("123", "A")];
  await synchronizeSource(store, discover, { sourceId: source.id, idempotencyKey: "aaa-2", observedAt: "2026-08-17T00:00:00.000Z" });

  assert.equal(store.jobs[0].snapshots.length, 2);
  assert.equal(store.jobs[0].currentSnapshot.id, firstSnapshotId);
  assert.ok(store.jobs[0].snapshots.some((snapshot) => snapshot.id === store.jobs[0].currentSnapshot.id));
});

test("overlapping source syncs are rejected while the same idempotency key remains safe", async () => {
  const store = new MemoryStore();
  const running: SyncRun = {
    id: "running", sourceId: source.id, idempotencyKey: "same", status: "running",
    observedAt: "2026-08-15T00:00:00.000Z", discoveredCount: 0, createdCount: 0,
    updatedCount: 0, unchangedCount: 0, closedCount: 0, completedAt: null, error: null,
  };
  store.runs.push(running);
  let calls = 0;
  const same = await synchronizeSource(store, async () => { calls += 1; return { jobs: [], complete: true }; }, {
    sourceId: source.id, idempotencyKey: "same", observedAt: "2026-08-15T00:00:00.000Z",
  });
  assert.equal(same.id, "running");
  assert.equal(calls, 0);
  await assert.rejects(() => synchronizeSource(store, async () => ({ jobs: [], complete: true }), {
    sourceId: source.id, idempotencyKey: "different", observedAt: "2026-08-15T00:01:00.000Z",
  }), /already running/i);
});

test("Scout owner authorization fails closed for missing configuration and non-owners", async () => {
  const unauthorized = await requireScoutApiUser(async () => null);
  assert.ok(unauthorized instanceof Response);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "Authentication required" });

  const unconfigured = await requireScoutApiUser(
    async () => ({ userId: "owner" }),
    async () => undefined,
  );
  assert.equal(unconfigured?.status, 503);
  assert.deepEqual(await unconfigured?.json(), { error: "Scout owner is not configured" });

  const forbidden = await requireScoutApiUser(
    async () => ({ userId: "other-user" }),
    async () => "owner",
  );
  assert.equal(forbidden?.status, 403);
  assert.deepEqual(await forbidden?.json(), { error: "Forbidden" });

  assert.equal(await requireScoutApiUser(
    async () => ({ userId: "owner" }),
    async () => "owner",
  ), null);
});

test("every Scout route and page applies owner auth and mutations apply same-origin checks", async () => {

  const apiRoot = new URL("../app/api/", import.meta.url);
  for (const relative of [
    "jobs/route.ts", "sources/route.ts", "sync/route.ts", "discover/route.ts",
    "contacts/route.ts", "claims/route.ts", "outreach/route.ts", "profile/route.ts", "applications/route.ts",
  ]) {
    const route = await readFile(new URL(relative, apiRoot), "utf8");
    const exportedMethods = [...route.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
    assert.ok(exportedMethods.length > 0, `${relative} must export an HTTP method`);
    assert.equal(
      (route.match(/requireScoutApiUser\(/g) ?? []).length,
      exportedMethods.length,
      `${relative} must authenticate every exported method`,
    );
    const mutationMethods = exportedMethods.filter((match) => match[1] !== "GET");
    assert.equal(
      (route.match(/requireSameOriginMutation\(/g) ?? []).length,
      mutationMethods.length,
      `${relative} must protect every mutation from cross-origin browser requests`,
    );
  }
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requireChatGPTUser\("\/"\)/);
  assert.match(page, /requireScoutPageOwner\(/);
});

test("same-origin mutation protection rejects hostile browser metadata and permits non-browser clients", async () => {
  assert.equal(requireSameOriginMutation(new Request("https://scout.example/api/jobs", { method: "PATCH" })), null);
  assert.equal(requireSameOriginMutation(new Request("https://scout.example/api/jobs", {
    method: "PATCH",
    headers: { origin: "https://scout.example", "sec-fetch-site": "same-origin" },
  })), null);

  for (const headers of [
    { origin: "https://evil.example" },
    { origin: "not-an-origin" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ]) {
    const denial = requireSameOriginMutation(new Request("https://scout.example/api/jobs", { method: "PATCH", headers }));
    assert.equal(denial?.status, 403);
    assert.deepEqual(await denial?.json(), { error: "Cross-origin mutation denied" });
  }
});

test("Scout payload validation rejects malformed objects, arrays, ids, versions, and oversized names", () => {
  assert.deepEqual(parseClaimCreatePayload({ statement: "  Reviewed fact  ", evidence: " Evidence " }), {
    statement: "Reviewed fact",
    evidence: "Evidence",
  });
  assert.deepEqual(parseClaimMutationPayload({ id: "claim-1", action: "approve", expectedVersion: 3 }), {
    id: "claim-1",
    action: "approve",
    expectedVersion: 3,
  });
  assert.deepEqual(parseOutreachCreatePayload({
    jobId: "job-1", contactId: "contact-1", claimIds: ["claim-b", "claim-a"], candidateName: "Asha Kumar",
  }).claimIds, ["claim-a", "claim-b"]);
  assert.deepEqual(parseOutreachMutationPayload({ id: "draft-1", action: "reject", revisionId: "revision-1" }), {
    id: "draft-1",
    action: "reject",
    revisionId: "revision-1",
  });
  assert.deepEqual(parseJobMutationPayload({ id: "job-1", state: "saved" }), { id: "job-1", state: "saved" });
  assert.deepEqual(parseContactExtractionPayload({ jobId: "job-1" }), { jobId: "job-1" });
  assert.deepEqual(parseContactReviewPayload({ id: "contact-1", reviewState: "accepted" }), {
    id: "contact-1",
    reviewState: "accepted",
  });
  assert.deepEqual(parseSyncPayload({ sourceId: "source-1", idempotencyKey: "manual:2026-08-15" }), {
    sourceId: "source-1",
    idempotencyKey: "manual:2026-08-15",
  });

  for (const invalid of [
    null,
    { jobId: "job", contactId: "contact", claimIds: "claim", candidateName: "Name" },
    { jobId: "job", contactId: "contact", claimIds: [42], candidateName: "Name" },
    { jobId: "job", contactId: "contact", claimIds: ["claim", "claim"], candidateName: "Name" },
    { jobId: "job", contactId: "contact", claimIds: ["claim"], candidateName: "x".repeat(121) },
    { jobId: "job", contactId: "contact", claimIds: ["claim"], candidateName: "Injected\nRecipient" },
    { jobId: " ", contactId: "contact", claimIds: ["claim"], candidateName: "Name" },
  ]) assert.throws(() => parseOutreachCreatePayload(invalid));

  for (const invalid of [
    { id: "claim", action: "approve" },
    { id: "claim", action: "approve", expectedVersion: 0 },
    { id: "claim", action: "edit", expectedVersion: 1, statement: [], evidence: "evidence" },
    { id: "x".repeat(129), action: "reject", expectedVersion: 1 },
  ]) assert.throws(() => parseClaimMutationPayload(invalid));

  assert.throws(() => parseClaimCreatePayload({ statement: "x".repeat(1001), evidence: "evidence" }));
  assert.throws(() => parseOutreachMutationPayload({ id: "draft", action: "edit", revisionId: "revision" }));
  assert.throws(() => parseOutreachMutationPayload({ id: [], action: "approve", revisionId: "revision" }));
  for (const invalid of [null, [], "job", 42]) {
    assert.throws(() => parseJobMutationPayload(invalid));
    assert.throws(() => parseContactExtractionPayload(invalid));
    assert.throws(() => parseContactReviewPayload(invalid));
    assert.throws(() => parseSyncPayload(invalid));
  }
  assert.throws(() => parseJobMutationPayload({ id: "job-1", state: "applied" }));
  assert.throws(() => parseContactExtractionPayload({ jobId: "x".repeat(129) }));
  assert.throws(() => parseContactReviewPayload({ id: "contact-1", reviewState: "verified" }));
  assert.throws(() => parseSyncPayload({ sourceId: "x", idempotencyKey: "valid-key" }));
  assert.throws(() => parseSyncPayload({ sourceId: "source-1", idempotencyKey: "bad key" }));
});

test("Greenhouse evidence URL binds exact board token and numeric external id", () => {
  assert.equal(
    validateGreenhouseEvidenceUrl("https://job-boards.greenhouse.io/acme/jobs/123", "acme", "123").href,
    "https://job-boards.greenhouse.io/acme/jobs/123",
  );
  assert.equal(
    validateGreenhouseEvidenceUrl("https://boards.greenhouse.io/acme/jobs/123", "acme", "123").hostname,
    "boards.greenhouse.io",
  );
  for (const invalid of [
    ["https://job-boards.greenhouse.io/other/jobs/123", "acme", "123"],
    ["https://job-boards.greenhouse.io/acme/jobs/999", "acme", "123"],
    ["https://careers.acme.example/jobs/123", "acme", "123"],
    ["https://job-boards.greenhouse.io/acme/jobs/not-numeric", "acme", "not-numeric"],
    ["http://job-boards.greenhouse.io/acme/jobs/123", "acme", "123"],
  ] as const) assert.throws(() => validateGreenhouseEvidenceUrl(...invalid));
});

test("resume alignment uses approved claims only and returns exact supporting claim ids", () => {
  const claims = [
    { id: "claim-product", status: "approved" as const, statement: "Led requirements and AI-assisted delivery of a clinic operations prototype.", evidence: "Node.js, Express, workflow mapping and 14 automated tests." },
    { id: "claim-research", status: "approved" as const, statement: "Supported adverse-drug-reaction data review and technical documentation.", evidence: "Government Medical College Jammu placement." },
    { id: "claim-licence-draft", status: "draft" as const, statement: "Hold a driver's licence.", evidence: "Unreviewed draft evidence." },
    { id: "claim-customer-rejected", status: "rejected" as const, statement: "Direct customer-facing experience.", evidence: "Rejected evidence." },
  ];
  const result = evaluateResumeAlignment({
    title: "Data Annotator - Fresh Graduate",
    description: "Review videos for accuracy, audit tags, follow operational procedures. A driver's license is required and direct customer-facing experience is preferred.",
    location: "Bengaluru",
  }, claims);

  assert.equal(result.band, "stretch");
  assert.ok(result.matches.includes("Product & operations"));
  assert.ok(result.matches.includes("Research & analysis"));
  assert.ok(result.matches.includes("Quality & documentation"));
  assert.deepEqual(result.supportingClaims.find((match) => match.theme === "Product & operations")?.claimIds, ["claim-product"]);
  assert.deepEqual(result.supportingClaims.find((match) => match.theme === "Research & analysis")?.claimIds, ["claim-research"]);
  assert.deepEqual(result.gaps, [
    "Driver's licence is required but is not evidenced in approved resume claims",
    "Direct customer-facing experience is requested but is not explicit in approved resume claims",
  ]);
  assert.equal(result.basis, "2 approved resume claims");
  assert.deepEqual(result.notChecked, ["Work authorization", "Availability", "Recruiter preference"]);
});

test("resume alignment ignores draft and rejected claims even when passed directly", () => {
  const result = evaluateResumeAlignment({
    title: "Product Operations Intern",
    description: "Support product workflows and operations.",
    location: "Remote",
  }, [
    { id: "draft-product", status: "draft", statement: "Product operations experience", evidence: "Unreviewed" },
    { id: "rejected-product", status: "rejected", statement: "Product operations experience", evidence: "Rejected" },
  ]);

  assert.equal(result.band, "unranked");
  assert.deepEqual(result.supportingClaims, []);
  assert.equal(result.basis, "No approved resume claims");
});

test("dashboard exposes claim review with expected-version mutation controls", async () => {
  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /const tabs = \["Jobs", "Apply", "Outreach", "Profile", "Sources", "Claims"\] as const/);
  assert.match(dashboard, /expectedVersion: claim\.version/);
  assert.match(dashboard, /`Approve version \$\{claim\.version\}`/);
  assert.match(dashboard, /disabled=\{claimBusy \|\| isDirty\}/);
  assert.match(dashboard, /Rejected claims are ignored by resume alignment/);
});



test("application preparation recognizes common internship channels and stops on missing evidence", () => {
  assert.equal(classifyApplicationUrl("https://jobs.lever.co/acme/123").id, "lever");
  assert.equal(classifyApplicationUrl("https://jobs.ashbyhq.com/acme/123").automation, "structured");
  assert.equal(classifyApplicationUrl("https://internshala.com/internship/detail/test").id, "internshala");
  assert.equal(classifyApplicationUrl("https://www.linkedin.com/jobs/view/123").automation, "manual_lead");
  assert.equal(classifyApplicationUrl("https://careers.acme.example/internships/1").id, "company");

  const prepared = buildApplicationPreparation({
    job: { id: "job-1", company: "Acme", title: "Product Intern", canonicalUrl: "https://jobs.lever.co/acme/123", currentSnapshotId: "snapshot-1" },
    profileFields: [
      { id: "p1", kind: "full_name", claim: "Asha Kumar", evidence: "ID", verified: true },
      { id: "p2", kind: "email", claim: "asha@example.com", evidence: "Inbox", verified: true },
      { id: "p3", kind: "current_location", claim: "India", evidence: "Profile", verified: true },
      { id: "p4", kind: "university", claim: "Example University", evidence: "Enrollment", verified: true },
      { id: "p5", kind: "program", claim: "Public Policy", evidence: "Enrollment", verified: true },
      { id: "p6", kind: "graduation_year", claim: "2029", evidence: "Enrollment", verified: true },
      { id: "p7", kind: "resume_reference", claim: "resume-v3.pdf", evidence: "Reviewed local file", verified: false },
    ],
    claims: [{ id: "claim-1", statement: "Built a workflow prototype", status: "approved" }],
    relevantClaimIds: ["claim-1"],
  });
  assert.equal(prepared.status, "needs_input");
  assert.match(prepared.blockers.join(" "), /resume_reference/);
  assert.equal(prepared.packet.channel.id, "lever");
  assert.deepEqual(prepared.packet.claimIds, ["claim-1"]);
  assert.equal(prepared.packet.externalSideEffect, false);
  assert.deepEqual(APPLICATION_PREP_CAPABILITIES, { prepare: true, submit: false, browserMutation: false });
});

test("profile and application payloads stay controlled", () => {
  assert.deepEqual(parseProfileUpsertPayload({ kind: "full_name", claim: "Asha Kumar", evidence: "Government ID" }), { kind: "full_name", claim: "Asha Kumar", evidence: "Government ID" });
  assert.deepEqual(parseProfileReviewPayload({ id: "p1", action: "verify" }), { id: "p1", action: "verify" });
  assert.deepEqual(parseApplicationPreparePayload({ jobId: "job-1" }), { jobId: "job-1" });
  assert.throws(() => parseProfileUpsertPayload({ kind: "work_authorization", claim: "yes", evidence: "guess" }), /unsupported/i);
  assert.throws(() => parseProfileReviewPayload({ id: "p1", action: "approve" }));
});

test("custom outreach opens a prefilled Gmail compose without a send capability", () => {
  const rendered = renderOutreachDraft({
    candidateName: "Asha Kumar", companyName: "Acme", roleTitle: "Product Intern", contactEmail: "recruiting@acme.example",
    jobSnapshotId: "snapshot-1", contactId: "contact-1", claims: [{ id: "claim-1", statement: "Built a workflow prototype" }],
  });
  const parsed = parseOutreachDraftForEmail(rendered.body);
  assert.equal(parsed.to, "recruiting@acme.example");
  assert.match(parsed.subject, /Product Intern at Acme/);
  assert.match(parsed.body, /workflow prototype/);
  const url = new URL(gmailComposeUrl(rendered.body));
  assert.equal(url.hostname, "mail.google.com");
  assert.equal(url.searchParams.get("to"), "recruiting@acme.example");
  assert.equal(url.searchParams.get("su"), parsed.subject);
  assert.deepEqual(OUTREACH_CAPABILITIES, { draft: true, send: false, apply: false });
});
test("contact extraction reads only persisted snapshot content with exact provenance", () => {
  const fetchedAt = "2026-08-15T10:00:00.000Z";
  const result = extractPublishedBusinessEmails({
    persistedContent: "Questions? Email recruiting@acme.example about internships. Personal: scout@gmail.com.",
    evidenceUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    boardToken: "acme",
    externalId: "123",
    companyDomain: "acme.example",
    now: () => fetchedAt,
  });

  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].email, "recruiting@acme.example");
  assert.equal(result.contacts[0].sourceUrl, "https://job-boards.greenhouse.io/acme/jobs/123");
  assert.equal(result.contacts[0].extractedAt, fetchedAt);
  assert.equal(result.contacts[0].suitability, "high");
  assert.equal(result.contacts[0].reviewState, "needs_review");
  assert.match(result.contacts[0].excerpt, /recruiting@acme\.example/);
  assert.deepEqual(result.rejections, [{
    email: "scout@gmail.com",
    sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    reason: "consumer-domain",
  }]);
});

test("contact extraction never fetches, infers, or accepts mismatched provenance", () => {
  const noEmail = extractPublishedBusinessEmails({
    persistedContent: "Contact our recruiting team.",
    evidenceUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    boardToken: "acme",
    externalId: "123",
    companyDomain: "acme.example",
    now: () => "2026-08-15T10:00:00.000Z",
  });
  assert.deepEqual(noEmail.contacts, []);

  assert.throws(() => extractPublishedBusinessEmails({
    persistedContent: "recruiting@acme.example",
    evidenceUrl: "https://job-boards.greenhouse.io/other/jobs/123",
    boardToken: "acme",
    externalId: "123",
    companyDomain: "acme.example",
  }), /board token/i);
});

test("approved claims are immutable and approval preserves the reviewed version", () => {
  const draft = { id: "claim-1", statement: "Built a SQL dashboard", evidence: "Portfolio project URL", status: "draft" as const, version: 4, createdAt: "2026-08-15T00:00:00.000Z", approvedAt: null };
  const approved = approveClaim(draft, "2026-08-15T01:00:00.000Z");
  assert.equal(approved.status, "approved");
  assert.equal(approved.version, 4);
  assert.throws(() => editClaim(approved, { statement: "Led a global team" }), /immutable/i);
});

test("outreach drafts are deterministic immutable revisions and approval is explicit", async () => {
  const input = {
    candidateName: "Asha Kumar",
    companyName: "Acme",
    roleTitle: "Product Intern",
    contactEmail: "recruiting@acme.example",
    jobSnapshotId: "snapshot-7",
    contactId: "contact-2",
    claims: [
      { id: "claim-b", statement: "Used SQL for cohort analysis" },
      { id: "claim-a", statement: "Interviewed users for a student project" },
    ],
  };
  const first = renderOutreachDraft(input);
  const second = renderOutreachDraft({ ...input, claims: [...input.claims].reverse() });
  assert.equal(first.body, second.body);
  assert.equal(await hashDraftBody(first.body), await hashDraftBody(second.body));
  assert.equal(await hashDraftBody(first.body), "9149a3da22e2da0548a14b605378be455f3b907fd02d70330b79882cf5532a19");
  assert.equal(new TextEncoder().encode(first.body).byteLength, 416);
  assert.deepEqual(first.claimIds, ["claim-a", "claim-b"]);
  assert.equal(first.jobSnapshotId, "snapshot-7");
  assert.equal(first.contactId, "contact-2");

  const draft = { id: "draft-1", state: "draft" as const, revisions: [{ ...first, id: "revision-1", version: 1, createdAt: "2026-08-15T00:00:00.000Z" }] };
  const approved = approveDraft(draft, "revision-1", "2026-08-15T00:10:00.000Z");
  assert.equal(approved.state, "approved");
  assert.equal(approved.approvedRevisionId, "revision-1");
  assert.deepEqual(OUTREACH_CAPABILITIES, { draft: true, send: false, apply: false });

  const domain = await readFile(new URL("../lib/scout/outreach.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/outreach/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(domain, /editDraft|Manual edit/);
  assert.doesNotMatch(route, /action\s*===\s*["']edit["']|body\?:\s*string/);
});

test("D1 sync updates preserve review state and Greenhouse ingestion is explicitly unranked", async () => {
  const store = await readFile(new URL("../lib/scout/d1-sync-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(store, /const values = \{[\s\S]*?state:\s*["']shortlisted["'][\s\S]*?\}\s+as const;/);
  assert.match(store, /insert\(jobs\)[\s\S]*state:\s*["']shortlisted["']/);

  const greenhouse = await readFile(new URL("../lib/scout/greenhouse.ts", import.meta.url), "utf8");
  assert.doesNotMatch(greenhouse, /defaultProfile|rankJob|CandidateProfile/);
  assert.match(greenhouse, /score:\s*0/);
  assert.match(greenhouse, /approved profile not configured/i);
});

test("migration enforces source identity, immutable approved claims, pinned revisions, and no send surface", async () => {
  const migration = await readFile(new URL("../drizzle/0001_scout_vertical.sql", import.meta.url), "utf8");
  assert.match(migration, /UNIQUE INDEX `idx_sync_runs_source_key` ON `sync_runs` \(`source_id`, `idempotency_key`\)/);
  assert.match(migration, /PRAGMA defer_foreign_keys=ON/);
  assert.doesNotMatch(migration, /PRAGMA foreign_keys=OFF/);
  for (const indexName of [
    "idx_company_sources_provider_token",
    "idx_job_snapshots_job_version",
    "idx_job_snapshots_job_hash",
    "idx_contact_evidence_provenance",
    "idx_outreach_revisions_draft_version",
  ]) assert.match(migration, new RegExp("UNIQUE INDEX `" + indexName + "`"));
  assert.match(migration, /UNIQUE INDEX `idx_jobs_registry_external` ON `jobs` \(`source_registry_id`, `external_id`\)/);
  assert.doesNotMatch(migration, /idx_jobs_source_external/);
  assert.match(migration, /idx_sync_runs_one_running_source/);
  assert.match(migration, /review_state/);
  assert.match(migration, /approved_revision_id/);
  assert.match(migration, /outreach_drafts_approval_revalidate/);
  assert.match(migration, /candidate_claims_approved_immutable_update/);
  assert.match(migration, /`version` integer DEFAULT 1 NOT NULL/);
  assert.match(migration, /job_snapshots_immutable_update/);
  assert.match(migration, /contact_evidence_snapshot_job_match/);
  assert.match(migration, /job_snapshot_id/);
  assert.match(migration, /contact_id/);
  assert.match(migration, /claim_ids/);

  const apiEntries = await readdir(new URL("../app/api/", import.meta.url), { recursive: true });
  assert.equal(apiEntries.some((entry) => /(?:send|apply)/i.test(String(entry))), false);
});
