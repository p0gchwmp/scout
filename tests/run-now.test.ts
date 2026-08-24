import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Run Scout now is owner-only, same-origin and has no send/submit surface", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /client\.discoverInternships\(\)/);
  assert.match(route, /const resolveInput = \{ canonicalUrl: lead\.canonicalUrl, company: lead\.company, title: lead\.title \}/);
  assert.match(route, /client\.resolveJob\(resolveInput\)/);
  assert.match(route, /client\.researchContacts/);
  assert.match(route, /client\.classifyContacts/);
  assert.doesNotMatch(route, /request\.json\(\)/);
  assert.doesNotMatch(route, /sendEmail\(|submitApplication\(|drafts\.send|messages\.send/);
  assert.match(route, /sendEmail: false/);
  assert.match(route, /submitApplication: false/);
  assert.match(route, /autoAcceptContact: false/);
  assert.match(route, /autoApproveApplication: false/);
});

test("Run Scout now is bounded and leaves contact decisions to human review", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /MAX_RESOLUTIONS_PER_RUN = 12/);
  assert.match(route, /MAX_APPLICATION_PREP_PER_RUN = 24/);
  assert.match(route, /MAX_DOMAIN_ENRICHMENT_PER_RUN = 8/);
  assert.match(route, /MAX_CONTACT_RESEARCH_PER_RUN = 6/);
  assert.match(route, /reviewState: "needs_review"/);
  assert.doesNotMatch(route, /reviewState:\s*"accepted"/);
  assert.doesNotMatch(route, /reviewState:\s*"rejected"/);
});

test("Run Scout now skips unresolved domains and upgrades only placeholder source domains", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /function unresolvedDomain/);
  assert.match(route, /value\.endsWith\("\.invalid"\)/);
  assert.match(route, /unresolvedDomain\(registered\.companyDomain\) && !unresolvedDomain\(official\.source\.companyDomain\)/);
  assert.match(route, /eq\(companySources\.companyDomain, registered\.companyDomain\)/);
  assert.match(route, /if \(!source\?\.enabled \|\| unresolvedDomain\(source\.companyDomain\)\) continue/);
  assert.doesNotMatch(route, /companyDomain:\s*official\.source\.companyDomain[\s\S]{0,160}where\(eq\(companySources\.id, registered\.id\)\)/);
});

test("Run Scout now retries unresolved domains without creating duplicate snapshots", async () => {
  const route = await readFile(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /domainCandidates\.slice\(0, MAX_DOMAIN_ENRICHMENT_PER_RUN\)/);
  assert.match(route, /const domainResolveInput = \{ canonicalUrl: job\.canonicalUrl, company: job\.company, title: job\.title \}/);
  assert.match(route, /official\.source\.provider !== source\.provider \|\| official\.source\.boardToken !== source\.boardToken/);
  assert.match(route, /eq\(companySources\.companyDomain, source\.companyDomain\)/);
  assert.match(route, /companyDomains: \{/);
  assert.match(route, /domainEnrichment: MAX_DOMAIN_ENRICHMENT_PER_RUN/);
  const retrySection = route.slice(route.indexOf("for (const { job, source } of domainCandidates"), route.indexOf("let contactJobsResearched"));
  assert.doesNotMatch(retrySection, /jobSnapshots|currentSnapshotId|db\.insert\(jobSnapshots\)/);
});

test("Internship Inbox uses cloud Run Scout first and localhost only as a loopback fallback", async () => {
  const ui = await readFile(new URL("../app/inbox/inbox-client.tsx", import.meta.url), "utf8");
  assert.match(ui, /fetch\("\/api\/agent\/run", \{ method: "POST" \}\)/);
  assert.match(ui, /function isLoopbackBrowser\(\)/);
  assert.match(ui, /if \(!isLoopbackBrowser\(\)\)/);
  assert.match(ui, /127\.0\.0\.1:43119\/discover/);
  assert.match(ui, /const response = await fetch\("\/api\/agent\/run"[\s\S]*await runLocalDevelopmentFallback\(\)/);
  assert.match(ui, />Run Scout now</);
});
