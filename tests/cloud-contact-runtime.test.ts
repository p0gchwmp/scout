import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("cloud AI routes are first-class and Ollama remains only the final local fallback", async () => {
  const runtime = await readFile(new URL("../agent/ai-runtime.ts", import.meta.url), "utf8");
  assert.match(runtime, /SCOUT_NIM_FREE_API_KEY/);
  assert.match(runtime, /SCOUT_GROQ_FREE_API_KEY/);
  assert.match(runtime, /SCOUT_GEMINI_FREE_API_KEY/);
  assert.match(runtime, /SCOUT_CEREBRAS_FREE_API_KEY/);
  assert.match(runtime, /SCOUT_OPENROUTER_FREE_API_KEY/);
  const classification = runtime.indexOf("for (const item of [nimLightning");
  const ollama = runtime.indexOf("openrouter, ollama", classification);
  assert.ok(classification >= 0 && ollama > classification, "Ollama must remain after configured cloud routes");
});

test("Gmail handoff is draft-only and cannot send email", async () => {
  const server = await readFile(new URL("../agent/server.ts", import.meta.url), "utf8");
  const gmail = await readFile(new URL("../agent/gmail-drafts.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/agent/create-gmail-draft/route.ts", import.meta.url), "utf8");
  assert.match(server, /\/v1\/create-gmail-draft/);
  assert.match(gmail, /createDraft: true/);
  assert.match(gmail, /sendDraft: false/);
  assert.match(gmail, /sendMessage: false/);
  assert.match(route, /state, "approved"/);
  assert.match(route, /sendEmail: false/);
  assert.doesNotMatch(gmail, /\/messages\/send/);
  assert.doesNotMatch(gmail, /\/drafts\/send/);
});
