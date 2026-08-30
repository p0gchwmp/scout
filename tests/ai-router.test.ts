import assert from "node:assert/strict";
import test from "node:test";
import { createQualityAiRouter, AiRouteExhaustedError, type ScoutAiWorker } from "../agent/ai-router.ts";
import { createAgentAiProvider } from "../agent/ai-runtime.ts";

function worker(label: string, calls: string[], fail = false): ScoutAiWorker {
  const record = async <T>(task: string, value: T): Promise<T> => {
    calls.push(`${label}:${task}`);
    if (fail) throw new Error(`${label} unavailable`);
    return value;
  };
  return {
    classifyPublishedContacts: async () => record("classification", []),
    draftOutreach: async () => record("outreach", { subject: "Subject", body: "Body", usedClaimIds: [] }),
    draftApplicationAnswers: async () => record("application", []),
  };
}

test("quality router stops at the first valid provider and fails over in configured order", async () => {
  const calls: string[] = [];
  const router = createQualityAiRouter({
    classification: [
      { id: "quality-fail", worker: worker("quality-fail", calls, true) },
      { id: "quality-good", worker: worker("quality-good", calls) },
      { id: "unused", worker: worker("unused", calls) },
    ],
    writing: [
      { id: "writer-good", worker: worker("writer-good", calls) },
      { id: "writer-unused", worker: worker("writer-unused", calls) },
    ],
  });

  await router.classifyPublishedContacts([]);
  await router.draftApplicationAnswers({} as never);
  assert.deepEqual(calls, ["quality-fail:classification", "quality-good:classification", "writer-good:application"]);
});

test("quality router exposes only provider ids and reports exhaustion without leaking provider errors", async () => {
  const calls: string[] = [];
  const router = createQualityAiRouter({
    classification: [{ id: "a", worker: worker("a", calls, true) }],
    writing: [{ id: "b", worker: worker("b", calls, true) }],
  });
  assert.deepEqual(router.routePlan, { classification: ["a"], writing: ["b"] });
  await assert.rejects(
    () => router.draftOutreach({} as never),
    (error: unknown) => error instanceof AiRouteExhaustedError && error.attemptedProviderIds.join(",") === "b",
  );
});

test("agent runtime prefers direct quality providers before optional pooled fallbacks", () => {
  const router = createAgentAiProvider({
    SCOUT_NIM_FREE_API_KEY: "n".repeat(32),
    SCOUT_GROQ_FREE_API_KEY: "g".repeat(32),
    SCOUT_GEMINI_FREE_API_KEY: "m".repeat(32),
  });

  assert.deepEqual(router.routePlan.classification.slice(0, 5), [
    "nim:nemotron-3.5-lightning",
    "nim:deepseek-v4-flash-0731",
    "groq:gpt-oss-120b",
    "gemini:3.7-flash",
    "groq:qwen3.6-27b",
  ]);
  assert.deepEqual(router.routePlan.writing.slice(0, 5), [
    "nim:deepseek-v4-flash-0731",
    "nim:nemotron-3-ultra",
    "gemini:3.7-flash",
    "groq:gpt-oss-120b",
    "nim:nemotron-3.5-lightning",
  ]);
});

test("Poe and OmniRoute are ignored unless explicitly declared included capacity", () => {
  assert.throws(() => createAgentAiProvider({
    SCOUT_POE_INCLUDED_API_KEY: "p".repeat(32),
    SCOUT_POE_MODEL: "Gemini-3.1-Pro",
    SCOUT_OMNIROUTE_INCLUDED_API_KEY: "o".repeat(32),
    SCOUT_OMNIROUTE_ENDPOINT_URL: "https://omni.example.com/v1/chat/completions",
    SCOUT_OMNIROUTE_MODEL: "cx/gpt-5.5",
  }), /No Scout AI provider is configured/);

  const router = createAgentAiProvider({
    SCOUT_POE_INCLUDED_ONLY: "1",
    SCOUT_POE_INCLUDED_API_KEY: "p".repeat(32),
    SCOUT_POE_MODEL: "Gemini-3.1-Pro",
    SCOUT_OMNIROUTE_INCLUDED_ONLY: "1",
    SCOUT_OMNIROUTE_INCLUDED_API_KEY: "o".repeat(32),
    SCOUT_OMNIROUTE_ENDPOINT_URL: "https://omni.example.com/v1/chat/completions",
    SCOUT_OMNIROUTE_MODEL: "cx/gpt-5.5",
  });
  assert.deepEqual(router.routePlan.writing.slice(0, 2), ["poe:Gemini-3.1-Pro", "omniroute:cx/gpt-5.5"]);
});

test("router does not silently consume generic provider keys", () => {
  assert.throws(() => createAgentAiProvider({
    NVIDIA_API_KEY: "n".repeat(32),
    GROQ_API_KEY: "g".repeat(32),
    GEMINI_API_KEY: "m".repeat(32),
  }), /No Scout AI provider is configured/);
});

test("router can reuse existing standard free-provider keys only after explicit opt-in", () => {
  const router = createAgentAiProvider({
    SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS: "1",
    NVIDIA_API_KEY: "n".repeat(32),
    GROQ_API_KEY: "g".repeat(32),
    GEMINI_API_KEY: "m".repeat(32),
  });
  assert.equal(router.routePlan.classification[0], "nim:nemotron-3.5-lightning");
  assert.equal(router.routePlan.writing[0], "nim:deepseek-v4-flash-0731");
});
