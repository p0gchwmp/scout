import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredAiProvider } from "../lib/scout/ai-provider.ts";
import { buildAiOutreachEnvelope } from "../lib/scout/ai-agent.ts";

function providerWith(content: unknown) {
  return createStructuredAiProvider({
    endpointUrl: "https://ai.example.com/v1/chat/completions",
    apiKey: "test-api-key",
    model: "test-model",
    costClass: "free_or_included",
    fetcher: (async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-api-key");
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
    }) as typeof fetch,
  });
}

function outreachEnvelope() {
  return buildAiOutreachEnvelope({
    jobSnapshotId: "snap-1",
    companyName: "Example",
    roleTitle: "Product Intern",
    candidateName: "Ryan",
    contact: { id: "contact-1", email: "careers@example.com", sourceUrl: "https://example.com/careers", excerpt: "careers@example.com", reviewState: "accepted" },
    claims: [{ id: "claim-1", statement: "Built a clinic operations prototype with workflow mapping and automated tests", status: "approved" }],
  });
}

test("AI provider refuses metered use unless explicitly enabled", () => {
  assert.throws(() => createStructuredAiProvider({
    endpointUrl: "https://ai.example.com/v1/chat/completions",
    apiKey: "test-api-key",
    model: "test-model",
    costClass: "metered",
  }), /Metered AI is disabled/);
});

test("AI provider allows HTTP only for explicit loopback development", () => {
  const base = {
    apiKey: "test-api-key",
    model: "test-model",
    costClass: "free_or_included" as const,
  };
  assert.throws(() => createStructuredAiProvider({
    ...base,
    endpointUrl: "http://127.0.0.1:11434/v1/chat/completions",
  }), /HTTPS outside explicit loopback development/);
  assert.doesNotThrow(() => createStructuredAiProvider({
    ...base,
    endpointUrl: "http://127.0.0.1:11434/v1/chat/completions",
    allowLoopbackDev: true,
  }));
  assert.doesNotThrow(() => createStructuredAiProvider({
    ...base,
    endpointUrl: "http://localhost:11434/v1/chat/completions",
    allowLoopbackDev: true,
  }));
  assert.throws(() => createStructuredAiProvider({
    ...base,
    endpointUrl: "http://192.168.1.50:11434/v1/chat/completions",
    allowLoopbackDev: true,
  }), /HTTPS outside explicit loopback development/);
});

test("AI provider classifies only explicitly published candidate IDs", async () => {
  const provider = providerWith({ classifications: [{ candidateId: "c1", suitability: "high", reason: "Explicit careers inbox" }] });
  const result = await provider.classifyPublishedContacts([{ id: "c1", email: "careers@example.com", sourceUrl: "https://example.com/careers", excerpt: "Internships: careers@example.com", sourceType: "official_careers" }]);
  assert.deepEqual(result, [{ candidateId: "c1", suitability: "high", reason: "Explicit careers inbox" }]);

  const bad = providerWith({ classifications: [{ candidateId: "invented", suitability: "high", reason: "Looks useful" }] });
  await assert.rejects(() => bad.classifyPublishedContacts([{ id: "c1", email: "careers@example.com", sourceUrl: "https://example.com/careers", excerpt: "Internships: careers@example.com", sourceType: "official_careers" }]), /not provided/);
});

test("AI outreach result is pinned to accepted evidence and approved claim IDs", async () => {
  const envelope = outreachEnvelope();
  const provider = providerWith({ subject: "Product Intern - Ryan", body: "Hi recruiting team,\n\nI came across the Product Intern role and wanted to reach out about it.", usedClaimIds: ["claim-1"] });
  const result = await provider.draftOutreach(envelope);
  assert.deepEqual(result.usedClaimIds, ["claim-1"]);

  const bad = providerWith({ subject: "Product Intern - Ryan", body: "Hi", usedClaimIds: ["claim-999"] });
  await assert.rejects(() => bad.draftOutreach(envelope), /unapproved claim id/);
});

test("high-quality writing deliberately refines a valid first draft without changing claim bindings", async () => {
  const responses = [
    { subject: "Product Intern - Ryan", body: "Hi recruiting team,\n\nI came across the Product Intern role and wanted to reach out about it. I built a clinic operations prototype with workflow mapping and automated tests.", usedClaimIds: ["claim-1"] },
    { subject: "Product Intern - Ryan", body: "Hi recruiting team,\n\nI saw the Product Intern opening and wanted to reach out. I have worked on a clinic operations prototype focused on workflow mapping and automated tests, which is why the role caught my attention.", usedClaimIds: ["claim-1"] },
  ];
  let calls = 0;
  const provider = createStructuredAiProvider({
    endpointUrl: "https://ai.example.com/v1/chat/completions",
    apiKey: "test-api-key",
    model: "test-model",
    costClass: "free_or_included",
    alwaysRefineWriting: true,
    fetcher: (async () => {
      const content = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
    }) as typeof fetch,
  });

  const result = await provider.draftOutreach(outreachEnvelope());
  assert.equal(calls, 2);
  assert.deepEqual(result.usedClaimIds, ["claim-1"]);
  assert.match(result.body, /workflow mapping and automated tests/);
});
