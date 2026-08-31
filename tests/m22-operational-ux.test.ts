import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Expected ${relativePath} to exist`);
  return readFileSync(absolutePath, "utf8");
}

function routeFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    return statSync(absolute).isDirectory() ? routeFiles(absolute) : [absolute];
  });
}

const shortlist = read("app/shortlist/shortlist-client.tsx");
const inbox = read("app/inbox/inbox-client.tsx");
const applications = read("app/applications/workspace-client.tsx");

test("M22 decision labels preserve the existing stored states", () => {
  assert.match(shortlist, /state:\s*"shortlisted"\s*\|\s*"saved"\s*\|\s*"rejected"/);

  // Assert behavior and labels independently. This deliberately avoids coupling
  // the test to JSX formatting or the `=>` token inside an onClick handler.
  assert.match(shortlist, /updateJob\(\s*job\.id\s*,\s*"shortlisted"\s*\)/);
  assert.match(shortlist, /updateJob\(\s*job\.id\s*,\s*"saved"\s*\)/);
  assert.match(shortlist, /updateJob\(\s*job\.id\s*,\s*"rejected"\s*\)/);
  assert.match(shortlist, />\s*Accept\s*</);
  assert.match(shortlist, />\s*Watch\s*</);
  assert.match(shortlist, />\s*Reject\s*</);

  assert.match(shortlist, /filter\s*===\s*"Accepted"[\s\S]*?job\.state\s*===\s*"shortlisted"/);
  assert.match(shortlist, /filter\s*===\s*"Watch"[\s\S]*?job\.state\s*===\s*"saved"/);
});

test("Watch remains preference-neutral while Accept and Reject keep their feedback mapping", () => {
  assert.match(
    shortlist,
    /state\s*===\s*"shortlisted"[\s\S]*?"interested"[\s\S]*?state\s*===\s*"rejected"[\s\S]*?"not_interested"[\s\S]*?:\s*null/,
  );
});

test("shortlist presents evidence and qualification checks without implying an application action", () => {
  assert.match(shortlist, /Why Scout surfaced this/);
  assert.match(shortlist, /Exact approved claim support/);
  assert.match(shortlist, /Qualification \/ evidence checks/);
  assert.match(shortlist, /claimIds\.join\(\s*["']\s*,\s*["']\s*\)/);
  assert.match(shortlist, /Accept, Watch and Reject change only Scout['’]s local review state/);
  assert.match(shortlist, /never sends email or submits applications/);
});

test("Inbox distinguishes discovery leads from evidence-backed fit decisions", () => {
  assert.match(inbox, /discovery leads, not final fit decisions/i);
  assert.match(inbox, /Exact approved claim IDs and qualification checks appear only after official resolution/i);
  assert.match(inbox, /href=["'{`]*\/shortlist/);
  assert.match(inbox, /does not claim resume support or qualification fit before that evidence exists/i);
});

test("Applications links into the dedicated role-evidence cockpit", () => {
  assert.match(applications, /Review role evidence/);
  assert.match(applications, /\/roles\/\$\{job\.id\}/);
});

test("M22 does not introduce send, submit, or apply API routes", () => {
  const apiRoot = path.join(root, "app", "api");
  const routes = routeFiles(apiRoot)
    .filter((file) => path.basename(file) === "route.ts" || path.basename(file) === "route.js")
    .map((file) => path.relative(apiRoot, file).replaceAll(path.sep, "/"));

  const forbidden = routes.filter((route) => /(^|\/)(send|submit|apply|application-submit)(\/|$)/i.test(route));
  assert.deepEqual(forbidden, []);
});
