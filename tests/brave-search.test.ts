import assert from "node:assert/strict";
import test from "node:test";
import { BRAVE_SEARCH_CAPABILITIES, createBraveSearchProvider } from "../lib/scout/brave-search.ts";

test("Brave search adapter uses one fixed endpoint and does not fetch result pages", async () => {
  assert.equal(BRAVE_SEARCH_CAPABILITIES.fetchResultPages, false);
  assert.equal(BRAVE_SEARCH_CAPABILITIES.scrapeLinkedIn, false);
  assert.equal(BRAVE_SEARCH_CAPABILITIES.persistResultsByDefault, false);
  let calls = 0;
  const provider = createBraveSearchProvider({
    apiKey: "test-search-key-123",
    costClass: "free_or_included",
    allowResultPersistence: true,
    fetcher: (async (input, init) => {
      calls += 1;
      const url = new URL(String(input));
      assert.equal(url.origin + url.pathname, "https://api.search.brave.com/res/v1/web/search");
      assert.equal(url.searchParams.get("country"), "IN");
      assert.equal(url.searchParams.get("search_lang"), "en");
      assert.equal(url.searchParams.get("freshness"), "pm");
      assert.equal(init?.headers && (init.headers as Record<string, string>)["x-subscription-token"], "test-search-key-123");
      return Response.json({ web: { results: [
        { url: "https://www.linkedin.com/jobs/view/123", title: "Acme hiring Product Intern in Bengaluru | LinkedIn", description: "Product internship in Bengaluru" },
        { url: "http://insecure.example.com/job", title: "Ignore me" },
      ] } });
    }) as typeof fetch,
  });
  const results = await provider.searchFixedQuery("product internship India remote");
  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://www.linkedin.com/jobs/view/123");
});

test("search adapter fails closed for metered use and exposes persistence permission explicitly", () => {
  assert.throws(() => createBraveSearchProvider({ apiKey: "test-search-key-123", costClass: "metered" }), /Metered search is disabled/);
  const provider = createBraveSearchProvider({ apiKey: "test-search-key-123", costClass: "free_or_included" });
  assert.equal(provider.allowResultPersistence, false);
});
