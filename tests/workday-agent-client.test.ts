import assert from "node:assert/strict";
import test from "node:test";
import { createScoutAgentClient } from "../lib/scout/agent-client.ts";

const secret = "a".repeat(64);

test("signed agent client accepts a provenance-shaped Workday resolved job", async () => {
  const boardToken = "acme.wd5.myworkdayjobs.com/en-US/External";
  const externalPath = "/job/Bengaluru/Product-Intern_R123";
  const canonicalUrl = `https://${boardToken}${externalPath}`;
  const client = createScoutAgentClient({
    baseUrl: "https://agent.example.com",
    sharedSecret: secret,
    now: () => new Date("2026-08-24T14:30:00.000Z"),
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
    fetcher: (async (input, init) => {
      assert.equal(String(input), "https://agent.example.com/v1/resolve");
      assert.equal(init?.method, "POST");
      const request = JSON.parse(String(init?.body)) as { canonicalUrl: string };
      assert.equal(request.canonicalUrl, canonicalUrl);
      return Response.json({
        taskId: "task-1",
        idempotencyKey: "key-1",
        schemaVersion: 1,
        resolvedAt: "2026-08-24T14:30:01.000Z",
        source: {
          id: "resolved-workday-acme",
          provider: "workday",
          companyName: "Acme Labs",
          boardToken,
          companyDomain: "acme.com",
          careersUrl: `https://${boardToken}`,
          enabled: true,
        },
        snapshot: {
          sourceProvider: "workday",
          externalId: externalPath,
          canonicalUrl,
          company: "Acme Labs",
          title: "Product Intern",
          description: "Product internship in India",
          location: "Bengaluru, India",
          workplaceType: "unspecified",
          score: 0,
          scoreExplanation: ["Unranked"],
          eligibilityRisks: [],
          postedAt: null,
        },
        contentHash: "b".repeat(64),
      });
    }) as typeof fetch,
  });

  const result = await client.resolveJob({ canonicalUrl });
  assert.equal(result.source.provider, "workday");
  assert.equal(result.source.boardToken, boardToken);
  assert.equal(result.snapshot.externalId, externalPath);
  assert.equal(result.contentHash, "b".repeat(64));
});
