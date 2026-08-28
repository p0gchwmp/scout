import assert from "node:assert/strict";
import test from "node:test";
import { SmartRecruitersAdapter } from "../lib/adapters.ts";

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

function posting(id: string, name: string) {
  return {
    id,
    name,
    company: { identifier: "acme", name: "Acme Labs" },
    releasedDate: "2026-08-28T08:00:00Z",
    location: { city: "Bengaluru", region: "Karnataka", country: "in", remote: false },
    postingUrl: `https://jobs.smartrecruiters.com/acme/${id}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    jobAd: { sections: { jobDescription: { text: `${name} description` } } },
    active: true,
  };
}

test("SmartRecruiters internship discovery fetches details only for early-career listing titles", async () => {
  const detailIds: string[] = [];
  const jobs = await withFetch((async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/companies/acme/postings") {
      return Response.json({
        totalFound: 3,
        content: [
          { id: "1010", name: "Product Intern" },
          { id: "2020", name: "Senior Engineer" },
          { id: "3030", name: "Finance Trainee" },
        ],
      });
    }
    const id = url.pathname.split("/").at(-1)!;
    detailIds.push(id);
    if (id === "1010") return Response.json(posting(id, "Product Intern"));
    if (id === "3030") return Response.json(posting(id, "Finance Trainee"));
    throw new Error(`unexpected detail fetch for ${id}`);
  }) as typeof fetch, () => new SmartRecruitersAdapter().discoverInternships("acme"));

  assert.deepEqual(detailIds.sort(), ["1010", "3030"]);
  assert.deepEqual(jobs.map((job) => job.title).sort(), ["Finance Trainee", "Product Intern"]);
});

test("SmartRecruiters generic discovery preserves full-source semantics", async () => {
  const detailIds: string[] = [];
  const jobs = await withFetch((async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/companies/acme/postings") {
      return Response.json({
        totalFound: 2,
        content: [
          { id: "1010", name: "Product Intern" },
          { id: "2020", name: "Senior Engineer" },
        ],
      });
    }
    const id = url.pathname.split("/").at(-1)!;
    detailIds.push(id);
    return Response.json(posting(id, id === "1010" ? "Product Intern" : "Senior Engineer"));
  }) as typeof fetch, () => new SmartRecruitersAdapter().discover("acme"));

  assert.deepEqual(detailIds.sort(), ["1010", "2020"]);
  assert.deepEqual(jobs.map((job) => job.title).sort(), ["Product Intern", "Senior Engineer"]);
});
