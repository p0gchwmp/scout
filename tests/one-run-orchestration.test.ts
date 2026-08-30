import assert from "node:assert/strict";
import test from "node:test";
import { dedupeEphemeralLeads, summarizeOutcomeQueue } from "../lib/scout/one-run-orchestration.ts";

test("M17 summarizes only explicit submitted outcomes and due dates", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const summary = summarizeOutcomeQueue([
    { status: "awaiting_reply", submittedAt: "2026-08-20T00:00:00.000Z", approvedAt: "2026-08-29T00:00:00.000Z" },
    { status: "interview", submittedAt: "2026-08-25T00:00:00.000Z", approvedAt: "2026-09-02T00:00:00.000Z" },
    { status: "rejected", submittedAt: "2026-08-10T00:00:00.000Z", approvedAt: "2026-08-29T00:00:00.000Z" },
    { status: "ready_for_review", submittedAt: null, approvedAt: "2026-08-29T00:00:00.000Z" },
  ], now);
  assert.deepEqual(summary, {
    submitted: 3,
    awaitingReply: 1,
    activeResponses: 1,
    terminal: 1,
    submittedWithoutOutcome: 0,
    followUpsDue: 1,
  });
});

test("M17 deduplicates ephemeral ecosystem leads by URL without persisting them", () => {
  const leads = dedupeEphemeralLeads([
    { url: "https://jobs.example/a", title: "A" },
    { url: "https://jobs.example/a", title: "Duplicate" },
    { url: "https://jobs.example/b", title: "B" },
  ]);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].title, "Duplicate");
});
