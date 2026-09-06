import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeReadiness, type RuntimeCoreReadiness } from "../lib/scout/runtime-readiness.ts";

const readyCore: RuntimeCoreReadiness = {
  database: { state: "ready", configured: true, required: true, detail: "Database reachable." },
  schema: { state: "ready", configured: true, required: true, detail: "Schema ready." },
  immutableEvidence: { state: "ready", configured: true, required: true, detail: "Immutable protections ready." },
};
const hex = "a".repeat(64);

test("runtime readiness never leaks secret values or endpoint URLs", () => {
  const out = JSON.stringify(buildRuntimeReadiness({
    SCOUT_SEARCH_PROVIDER: "brave", SCOUT_SEARCH_API_KEY: "SEARCH_SECRET_SENTINEL", SCOUT_SEARCH_COST_CLASS: "free_or_included",
    SCOUT_AI_ENDPOINT_URL: "https://ai.example.test/v1/chat/completions", SCOUT_AI_API_KEY: "AI_SECRET_SENTINEL", SCOUT_AI_MODEL: "model", SCOUT_AI_COST_CLASS: "free_or_included",
    SCOUT_AGENT_BASE_URL: "https://agent.example.test", SCOUT_AGENT_SHARED_SECRET: hex, SCOUT_BROWSER_HANDOFF_SECRET: "b".repeat(64),
  }, readyCore));
  for (const secret of ["SEARCH_SECRET_SENTINEL", "AI_SECRET_SENTINEL", hex, "b".repeat(64), "https://ai.example.test", "https://agent.example.test"]) assert.equal(out.includes(secret), false);
});

test("search distinguishes disabled, free and metered permission states", () => {
  assert.equal(buildRuntimeReadiness({}, readyCore).capabilities.search.state, "disabled");
  assert.equal(buildRuntimeReadiness({ SCOUT_SEARCH_PROVIDER: "tavily", SCOUT_SEARCH_API_KEY: "search-key-123", SCOUT_SEARCH_COST_CLASS: "free_or_included" }, readyCore).capabilities.search.state, "ready");
  assert.equal(buildRuntimeReadiness({ SCOUT_SEARCH_PROVIDER: "brave", SCOUT_SEARCH_API_KEY: "search-key-123", SCOUT_SEARCH_COST_CLASS: "metered" }, readyCore).capabilities.search.state, "blocked");
  const allowed = buildRuntimeReadiness({ SCOUT_SEARCH_PROVIDER: "brave", SCOUT_SEARCH_API_KEY: "search-key-123", SCOUT_SEARCH_COST_CLASS: "metered", SCOUT_ALLOW_METERED_SEARCH: "1", SCOUT_SEARCH_RESULT_PERSISTENCE_ALLOWED: "1" }, readyCore);
  assert.equal(allowed.capabilities.search.state, "ready");
  assert.equal(allowed.policies.searchResultPersistence, "enabled");
});

test("AI reports explicit, free-provider and included-gateway states", () => {
  assert.equal(buildRuntimeReadiness({ SCOUT_AI_MODEL: "model" }, readyCore).capabilities.ai.state, "incomplete");
  const metered = { SCOUT_AI_ENDPOINT_URL: "https://ai.example.test/v1/chat/completions", SCOUT_AI_API_KEY: "api-key-123", SCOUT_AI_MODEL: "model", SCOUT_AI_COST_CLASS: "metered" };
  assert.equal(buildRuntimeReadiness(metered, readyCore).capabilities.ai.state, "blocked");
  assert.equal(buildRuntimeReadiness({ ...metered, SCOUT_ALLOW_METERED_AI: "1" }, readyCore).capabilities.ai.state, "ready");
  assert.equal(buildRuntimeReadiness({ SCOUT_GROQ_FREE_API_KEY: "groq-key-123" }, readyCore).capabilities.ai.state, "ready");
  assert.equal(buildRuntimeReadiness({ GROQ_API_KEY: "groq-key-123" }, readyCore).capabilities.ai.state, "disabled");
  assert.equal(buildRuntimeReadiness({ SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS: "1", GROQ_API_KEY: "groq-key-123" }, readyCore).capabilities.ai.state, "ready");
  assert.equal(buildRuntimeReadiness({ SCOUT_POE_INCLUDED_ONLY: "1", SCOUT_POE_INCLUDED_API_KEY: "poe-key-123" }, readyCore).capabilities.ai.state, "incomplete");
});

test("agent, browser and Gmail readiness remain strict and config-only", () => {
  assert.equal(buildRuntimeReadiness({ SCOUT_AGENT_BASE_URL: "http://agent.example.test", SCOUT_AGENT_SHARED_SECRET: hex }, readyCore).capabilities.cloudAgent.state, "invalid");
  assert.equal(buildRuntimeReadiness({ SCOUT_AGENT_BASE_URL: "http://localhost:8788", SCOUT_AGENT_SHARED_SECRET: hex, SCOUT_AGENT_ALLOW_LOOPBACK_DEV: "1" }, readyCore).capabilities.cloudAgent.state, "ready");
  assert.equal(buildRuntimeReadiness({ SCOUT_BROWSER_HANDOFF_SECRET: "short" }, readyCore).capabilities.browserHandoff.state, "invalid");
  const gmail = buildRuntimeReadiness({ SCOUT_AGENT_BASE_URL: "https://agent.example.test", SCOUT_AGENT_SHARED_SECRET: hex }, readyCore);
  assert.equal(gmail.capabilities.gmailDraft.state, "unverified");
  assert.match(gmail.capabilities.gmailDraft.detail, /not probed/i);
});

test("hosted local agent readiness matches the exact private runtime contract", () => {
  const hosted = { SCOUT_AGENT_SHARED_SECRET: hex, SCOUT_AGENT_ALLOW_LOCAL_RUNTIME: "1" };
  assert.equal(buildRuntimeReadiness({ ...hosted, SCOUT_AGENT_BASE_URL: "http://127.0.0.1:43127" }, readyCore).capabilities.cloudAgent.state, "ready");
  for (const base of [
    "http://localhost:43127",
    "http://127.0.0.1",
    "https://127.0.0.1:43127",
    "http://127.0.0.1:43127/path",
  ]) {
    assert.equal(buildRuntimeReadiness({ ...hosted, SCOUT_AGENT_BASE_URL: base }, readyCore).capabilities.cloudAgent.state, "invalid");
  }
  assert.equal(buildRuntimeReadiness({ SCOUT_AGENT_BASE_URL: "http://127.0.0.1:43127", SCOUT_AGENT_SHARED_SECRET: hex }, readyCore).capabilities.cloudAgent.state, "invalid");
});

test("core failures block readiness while consequential side effects remain unavailable", () => {
  const blocked = buildRuntimeReadiness({}, { ...readyCore, immutableEvidence: { state: "blocked", configured: false, required: true, detail: "Missing triggers.", missing: ["job_snapshots_immutable_update"] } });
  assert.equal(blocked.status, "blocked");
  const ready = buildRuntimeReadiness({}, readyCore);
  assert.equal(ready.zeroNetwork, true);
  assert.equal(ready.policies.applicationSubmission, false);
  assert.equal(ready.policies.emailSending, false);
  assert.equal(ready.policies.captchaSolving, false);
  assert.equal(ready.policies.privateContactScraping, false);
  assert.equal(ready.demo.productionExecutionProhibited, true);
});
