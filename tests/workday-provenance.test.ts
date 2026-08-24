import assert from "node:assert/strict";
import test from "node:test";
import { extractPublishedBusinessEmails, validateWorkdayEvidenceUrl } from "../lib/scout/contact-extraction.ts";
import { parseWorkdayBoardToken, parseWorkdayPublicUrl } from "../lib/scout/workday-source.ts";

const boardToken = "acme.wd5.myworkdayjobs.com/en-US/External";
const externalPath = "/job/Bengaluru/Product-Intern_R123";
const jobUrl = `https://${boardToken}${externalPath}`;

test("Workday parser binds observed host, shard, locale, career site and exact job path", () => {
  const board = parseWorkdayBoardToken(boardToken);
  assert.equal(board.tenant, "acme");
  assert.equal(board.shard, "wd5");
  assert.equal(board.site, "External");
  assert.equal(board.locale, "en-US");
  assert.equal(board.boardUrl, `https://${boardToken}`);

  const job = parseWorkdayPublicUrl(jobUrl);
  assert.equal(job.boardToken, boardToken);
  assert.equal(job.externalPath, externalPath);
  assert.equal(job.canonicalUrl, jobUrl);
});

test("Workday evidence rejects a different tenant, site, path, query or non-candidate host", () => {
  assert.equal(validateWorkdayEvidenceUrl(jobUrl, boardToken, externalPath).href, jobUrl);
  for (const invalid of [
    "https://other.wd5.myworkdayjobs.com/en-US/External/job/Bengaluru/Product-Intern_R123",
    "https://acme.wd5.myworkdayjobs.com/en-US/Other/job/Bengaluru/Product-Intern_R123",
    "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Bengaluru/Other_R999",
    `${jobUrl}?source=linkedin`,
    "https://example.com/en-US/External/job/Bengaluru/Product-Intern_R123",
  ]) assert.throws(() => validateWorkdayEvidenceUrl(invalid, boardToken, externalPath));
});

test("Workday contact extraction reads only the persisted exact posting snapshot", () => {
  const result = extractPublishedBusinessEmails({
    provider: "workday",
    persistedContent: "Questions about this internship: recruiting@acme.example",
    evidenceUrl: jobUrl,
    boardToken,
    externalId: externalPath,
    companyDomain: "acme.example",
    now: () => "2026-08-24T14:30:00.000Z",
  });
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].email, "recruiting@acme.example");
  assert.equal(result.contacts[0].sourceUrl, jobUrl);
  assert.equal(result.contacts[0].sourceType, "official_job_posting");
  assert.equal(result.contacts[0].reviewState, "needs_review");
});
