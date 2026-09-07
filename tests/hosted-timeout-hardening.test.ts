import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contactResearch = await readFile(new URL("../agent/contact-research.ts", import.meta.url), "utf8");
const autopilot = await readFile(new URL("../app/api/company-outreach/autopilot/route.ts", import.meta.url), "utf8");
const manualResearch = await readFile(new URL("../app/api/company-outreach/research/route.ts", import.meta.url), "utf8");
const ecosystem = await readFile(new URL("../app/api/ecosystem/route.ts", import.meta.url), "utf8");
const brave = await readFile(new URL("../lib/scout/brave-search.ts", import.meta.url), "utf8");
const tavily = await readFile(new URL("../lib/scout/tavily-search.ts", import.meta.url), "utf8");

test("contact research has an internal deadline instead of relying only on the caller timeout", () => {
  assert.match(contactResearch, /deadlineAt\?: number/);
  assert.match(contactResearch, /maxPages\?: number/);
  assert.match(contactResearch, /pageTimeoutMs\?: number/);
  assert.match(contactResearch, /Contact research deadline reached/);
  assert.match(contactResearch, /deferredDueToTime/);
  assert.match(contactResearch, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(contactResearch, /companyDomainBoundFirstParty: true/);
  assert.match(contactResearch, /guessEmail: false/);
});

test("company outreach autopilot returns partial progress before the hosted request deadline", () => {
  assert.match(autopilot, /createRunBudget\(\)/);
  assert.match(autopilot, /RUN_RESPONSE_RESERVE_MS/);
  assert.match(autopilot, /deadlineAt/);
  assert.match(autopilot, /CONTACT_PAGE_TIMEOUT_MS = 3_000/);
  assert.match(autopilot, /CONTACT_MAX_PAGES_PER_TARGET = 6/);
  assert.match(autopilot, /deferredTargets/);
  assert.match(autopilot, /partial: deferredTargets > 0/);
  assert.match(autopilot, /orderBy\(asc\(companyOutreachTargets\.updatedAt\)/);
  assert.match(autopilot, /reviewState: "needs_review"/);
  assert.doesNotMatch(autopilot, /messages\.send|drafts\.send|submitApplication/);
});

test("manual company research and ecosystem research share the same bounded crawl contract", () => {
  for (const source of [manualResearch, ecosystem]) {
    assert.match(source, /createRunBudget\(\)/);
    assert.match(source, /RUN_RESPONSE_RESERVE_MS/);
    assert.match(source, /deadlineAt/);
    assert.match(source, /pageTimeoutMs:/);
    assert.match(source, /maxPages:/);
    assert.match(source, /reviewState: "needs_review"/);
  }
  assert.match(ecosystem, /provider\.searchFixedQuery\(query\.query, \{ timeoutMs \}\)/);
  assert.match(ecosystem, /deferredTargets/);
});

test("Brave and Tavily search calls can be shortened by hosted callers but not extended past provider defaults", () => {
  for (const source of [brave, tavily]) {
    assert.match(source, /SearchCallOptions/);
    assert.match(source, /MIN_SEARCH_TIMEOUT_MS = 250/);
    assert.match(source, /timeoutMs > SEARCH_TIMEOUT_MS/);
    assert.match(source, /AbortSignal\.timeout\(searchTimeout\(callOptions\)\)/);
  }
});
