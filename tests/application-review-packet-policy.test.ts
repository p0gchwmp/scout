import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const applicationsRoute = await readFile(new URL("../app/api/applications/route.ts", import.meta.url), "utf8");
const browserTaskRoute = await readFile(new URL("../app/api/applications/browser-task/route.ts", import.meta.url), "utf8");
const readinessClient = await readFile(new URL("../app/readiness/readiness-client.tsx", import.meta.url), "utf8");

test("application preparation builds M8 review evidence from the immutable current snapshot", () => {
  assert.match(applicationsRoute, /jobSnapshots/);
  assert.match(applicationsRoute, /buildApplicationReviewPacket/);
  assert.match(applicationsRoute, /currentSnapshotId && !snapshot/);
  assert.match(applicationsRoute, /submittedFields: \{ \.\.\.prepared\.packet, review \}/);
});

test("browser assistance fails closed when a prepared packet is pinned to an old job snapshot", () => {
  assert.match(browserTaskRoute, /applicationPacketMatchesCurrentSnapshot/);
  assert.match(browserTaskRoute, /job snapshot changed/);
  assert.match(browserTaskRoute, /status: 409/);
  assert.doesNotMatch(browserTaskRoute, /sendEmail|submitApplication\s*:\s*true/);
});

test("readiness UI requires packet currency in addition to readiness and packet status", () => {
  assert.match(readinessClient, /applicationPacketMatchesCurrentSnapshot/);
  assert.match(readinessClient, /readiness\.status === "ready" && application\?\.status === "ready_for_review" && !application\.submittedAt && packetCurrent/);
  assert.match(readinessClient, /snapshot stale/);
  assert.match(readinessClient, /Safe Fill locked/);
});

test("M8 UI keeps application and outreach decisions explicitly human-reviewed", () => {
  assert.match(readinessClient, /No role is auto-rejected/);
  assert.match(readinessClient, /does not submit an application or send outreach/);
  assert.match(readinessClient, /Full role cockpit/);
});
