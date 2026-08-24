import assert from "node:assert/strict";
import test from "node:test";
import { createScoutAgentClient } from "../lib/scout/agent-client.ts";

const secret = "a".repeat(64);

test("signed agent client accepts a provenance-shaped BambooHR resolved job", async () => {
  const client = createScoutAgentClient({
    baseUrl: "https://agent.example.com",
    sharedSecret: secret,
    now: () => new Date("2026-08-24T15:00:00.000Z"),
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
    fetcher: (async (input, init) => {
      assert.equal(String(input), "https://agent.example.com/v1/resolve");
      assert.equal(init?.method, "POST");
      const request = JSON.parse(String(init?.body)) as { canonicalUrl: string };
      assert.equal(request.canonicalUrl, "https://acme.bamboohr.com/careers/42");
      return Response.json({
        taskId: "task-1",
        idempotencyKey: "key-1",
        schemaVersion: 1,
        resolvedAt: "2026-08-24T15:00:01.000Z",
        source: {
          id: "resolved-bamboohr-acme",
          provider: "bamboohr",
          companyName: "Acme Labs",
          boardToken: "acme",
          companyDomain: "acme.com",
          careersUrl: "https://acme.bamboohr.com/careers",
          enabled: true,
        },
        snapshot: {
          sourceProvider: "bamboohr",
          externalId: "42",
          canonicalUrl: "https://acme.bamboohr.com/careers/42",
          company: "Acme Labs",
          title: "Product Intern",
          description: "Product internship in India",
          location: "Bengaluru, Karnataka, India",
          workplaceType: "hybrid",
          score: 0,
          scoreExplanation: ["Unranked"],
          eligibilityRisks: [],
          postedAt: "2026-08-23",
        },
        contentHash: "b".repeat(64),
      });
    }) as typeof fetch,
  });

  const result = await client.resolveJob({ canonicalUrl: "https://acme.bamboohr.com/careers/42" });
  assert.equal(result.source.provider, "bamboohr");
  assert.equal(result.snapshot.sourceProvider, "bamboohr");
  assert.equal(result.snapshot.externalId, "42");
  assert.equal(result.contentHash, "b".repeat(64));
});
