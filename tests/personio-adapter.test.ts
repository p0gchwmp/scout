import assert from "node:assert/strict";
import test from "node:test";
import { PersonioPublicXmlAdapter, parsePersonioPublicJobUrl } from "../lib/personio-adapter.ts";

const XML = `<?xml version="1.0"?><workzag-jobs>
<position><id>4103</id><subcompany>Acme Labs</subcompany><office>Remote - India</office><department>Product</department><name>Product Operations Intern</name><jobDescriptions><jobDescription><name>Your mission</name><value><![CDATA[Map workflows, analyze data, and support QA.]]></value></jobDescription></jobDescriptions><employmentType>intern</employmentType><seniority>student</seniority><schedule>full-time</schedule><createdAt>2026-08-31T12:14:07+0200</createdAt></position>
<position><id>4104</id><office>Berlin</office><name>Finance Trainee</name><jobDescriptions><jobDescription><name>Role</name><value><![CDATA[Hybrid finance research role.]]></value></jobDescription></jobDescriptions><employmentType>trainee</employmentType><seniority>entry-level</seniority><schedule>full-time</schedule></position>
</workzag-jobs>`;

function installFetch(handler: (url: string) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => handler(input instanceof Request ? input.url : input.toString())) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("Personio exact job URL parsing binds tenant and numeric id", () => {
  assert.deepEqual(parsePersonioPublicJobUrl("https://acme.jobs.personio.de/job/4103"), {
    tenant: "acme", externalId: "4103", canonicalUrl: "https://acme.jobs.personio.de/job/4103",
  });
  for (const bad of [
    "http://acme.jobs.personio.de/job/4103",
    "https://evil.example/job/4103",
    "https://acme.jobs.personio.com/job/4103",
    "https://acme.jobs.personio.de/job/nope",
    "https://acme.jobs.personio.de/job/4103?apply=1",
    "https://www.jobs.personio.de/job/4103",
  ]) assert.throws(() => parsePersonioPublicJobUrl(bad));
});

test("Personio adapter reads only the documented public XML feed and normalizes jobs", async () => {
  const calls: string[] = [];
  const restore = installFetch((url) => {
    calls.push(url);
    return new Response(XML, { status: 200, headers: { "content-type": "application/xml" } });
  });
  try {
    const jobs = await new PersonioPublicXmlAdapter().discover("acme");
    assert.deepEqual(calls, ["https://acme.jobs.personio.de/xml?language=en"]);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].canonicalUrl, "https://acme.jobs.personio.de/job/4103");
    assert.equal(jobs[0].company, "Acme Labs");
    assert.equal(jobs[0].workplaceType, "remote");
    assert.match(jobs[0].description, /Your mission: Map workflows/);
    assert.equal(jobs[1].workplaceType, "hybrid");
  } finally { restore(); }
});

test("Personio adapter exposes no submission, credential, or candidate-creation capability", () => {
  const adapter = new PersonioPublicXmlAdapter();
  assert.equal(adapter.capabilities.discovery, true);
  assert.equal(adapter.capabilities.submission, false);
  assert.equal(adapter.capabilities.publicXmlFeedOnly, true);
  assert.equal(adapter.capabilities.noCredentials, true);
  assert.equal(adapter.capabilities.candidateCreation, false);
  assert.equal(adapter.capabilities.applicationWriteApi, false);
});

test("Personio adapter can resolve an exact posting from the bounded public feed", async () => {
  const restore = installFetch(() => new Response(XML, { status: 200, headers: { "content-type": "application/xml" } }));
  try {
    const adapter = new PersonioPublicXmlAdapter();
    assert.equal((await adapter.discoverPosting("acme", "4104"))?.title, "Finance Trainee");
    assert.equal(await adapter.discoverPosting("acme", "9999"), null);
    await assert.rejects(() => adapter.discoverPosting("acme", "nope"), /external id is invalid/);
  } finally { restore(); }
});

test("Personio adapter rejects oversized and non-jobs responses", async () => {
  let restore = installFetch(() => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }));
  try { await assert.rejects(() => new PersonioPublicXmlAdapter().discover("acme"), /unsupported content|expected jobs document/); }
  finally { restore(); }

  restore = installFetch(() => new Response(XML, { status: 200, headers: { "content-type": "application/xml", "content-length": "2000000" } }));
  try { await assert.rejects(() => new PersonioPublicXmlAdapter().discover("acme"), /safe size limit/); }
  finally { restore(); }
});
