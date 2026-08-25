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
      { id: "fast-fail", worker: worker("fast-fail", calls, true) },
      { id: "fast-good", worker: worker("fast-good", calls) },
      { id: "unused", worker: worker("unused", calls) },
    ],
    writing: [
      { id: "writer-good", worker: worker("writer-good", calls) },
      { id: "writer-unused", worker: worker("writer-unused", calls) },
    ],
  });

  await router.classifyPublishedContacts([]);
  await router.draftApplicationAnswers({} as never);
  assert.deepEqual(calls, ["fast-fail:classification", "fast-good:classification", "writer-good:application"]);
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

test("agent runtime prefers fast models for classification and stronger models for writing", () => {
  const router = createAgentAiProvider({
    SCOUT_NIM_FREE_API_KEY: "n".repeat(32),
    SCOUT_GROQ_FREE_API_KEY: "g".repeat(32),
    SCOUT_GEMINI_FREE_API_KEY: "m".repeat(32),
  });

  assert.deepEqual(router.routePlan.classification.slice(0, 5), [
    "groq:qwen3.6-27b",
    "nim:nemotron-3.5-lightning",
    "groq:gpt-oss-120b",
    "gemini:3.7-flash",
    "nim:deepseek-v4-flash-0731",
  ]);
  assert.deepEqual(router.routePlan.writing.slice(0, 5), [
    "nim:deepseek-v4-flash-0731",
    "nim:nemotron-3-ultra",
    "groq:gpt-oss-120b",
    "gemini:3.7-flash",
    "nim:nemotron-3.5-lightning",
  ]);
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
  assert.equal(router.routePlan.classification[0], "groq:qwen3.6-27b");
  assert.equal(router.routePlan.writing[0], "nim:deepseek-v4-flash-0731");
});
