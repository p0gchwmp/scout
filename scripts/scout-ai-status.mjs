import { createAgentAiProvider } from "../agent/ai-runtime.ts";

const providers = [
  ["NVIDIA NIM", "SCOUT_NIM_FREE_API_KEY", ["NVIDIA_API_KEY", "NGC_API_KEY"]],
  ["Groq", "SCOUT_GROQ_FREE_API_KEY", ["GROQ_API_KEY"]],
  ["Gemini", "SCOUT_GEMINI_FREE_API_KEY", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]],
  ["Cerebras", "SCOUT_CEREBRAS_FREE_API_KEY", ["CEREBRAS_API_KEY"]],
  ["OpenRouter", "SCOUT_OPENROUTER_FREE_API_KEY", ["OPENROUTER_API_KEY"]],
];

const allowStandard = process.env.SCOUT_USE_STANDARD_FREE_PROVIDER_KEYS?.trim() === "1";
const qualityMode = process.env.SCOUT_AI_QUALITY_MODE?.trim().toLowerCase() === "balanced" ? "balanced" : "high";
console.log(`Scout AI quality mode: ${qualityMode}${qualityMode === "high" ? " (deliberate second-pass refinement for external writing)" : ""}`);
console.log(`Scout AI standard-key reuse: ${allowStandard ? "enabled" : "disabled"}`);
for (const [label, scoutKey, standardKeys] of providers) {
  const scoutConfigured = Boolean(process.env[scoutKey]?.trim());
  const standardConfigured = standardKeys.some((key) => Boolean(process.env[key]?.trim()));
  const usable = scoutConfigured || (allowStandard && standardConfigured);
  console.log(`${label}: ${usable ? "configured" : "not configured"}${!scoutConfigured && standardConfigured && !allowStandard ? " (standard key exists but opt-in is off)" : ""}`);
}

const ollamaConfigured = Boolean(
  process.env.SCOUT_OLLAMA_ENDPOINT_URL?.trim()
  && process.env.SCOUT_OLLAMA_API_KEY?.trim()
  && process.env.SCOUT_OLLAMA_MODEL?.trim(),
);
console.log(`Ollama fallback: ${ollamaConfigured ? `configured (${process.env.SCOUT_OLLAMA_MODEL})` : "not configured in this shell"}`);

try {
  const router = createAgentAiProvider(process.env);
  console.log("\nClassification route:");
  router.routePlan.classification.forEach((id, index) => console.log(`  ${index + 1}. ${id}`));
  console.log("\nWriting/reasoning route:");
  router.routePlan.writing.forEach((id, index) => console.log(`  ${index + 1}. ${id}`));
} catch (error) {
  console.log(`\nNo runnable AI route in this shell: ${error instanceof Error ? error.message : "unknown configuration error"}`);
  console.log("npm run dev may still auto-add a loopback Ollama fallback if Ollama is running.");
}
