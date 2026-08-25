import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseApplicationProgressMutationPayload } from "../lib/scout/api-validation.ts";

test("external submission record payload is version-bound and accepts only optional HTTPS confirmation evidence", () => {
  assert.deepEqual(parseApplicationProgressMutationPayload({
    action: "mark_external_submission",
    applicationId: "application-1",
    expectedArtifactVersion: 3,
    confirmationUrl: "https://jobs.example.com/confirmation/abc",
  }), {
    action: "mark_external_submission",
    applicationId: "application-1",
    expectedArtifactVersion: 3,
    confirmationUrl: "https://jobs.example.com/confirmation/abc",
  });
  assert.deepEqual(parseApplicationProgressMutationPayload({
    action: "clear_external_submission",
    applicationId: "application-1",
    expectedArtifactVersion: 3,
  }), {
    action: "clear_external_submission",
    applicationId: "application-1",
    expectedArtifactVersion: 3,
  });
  assert.throws(() => parseApplicationProgressMutationPayload({
    action: "mark_external_submission",
    applicationId: "application-1",
    expectedArtifactVersion: 3,
    confirmationUrl: "http://jobs.example.com/confirmation",
  }), /HTTPS URL/);
});

test("application progress mutation is owner-only same-origin recordkeeping with no employer-side action", async () => {
  const route = await readFile(new URL("../app/api/application-progress/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /eq\(applications\.artifactVersion, payload\.expectedArtifactVersion\)/);
  assert.match(route, /recordOnly: true/);
  assert.match(route, /externalSideEffect: false/);
  assert.match(route, /submitApplication: false/);
  assert.doesNotMatch(route, /fetch\(|requestSubmit\(|\.submit\(\)|\.click\(\)/);
});

test("application workspace requires owner auth and protects the record-only submission wording", async () => {
  const [page, client, worker] = await Promise.all([
    readFile(new URL("../app/applications/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/applications/workspace-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /requireChatGPTUser\("\/applications"\)/);
  assert.match(page, /requireScoutPageOwner/);
  assert.match(worker, /"\/applications"/);
  assert.match(client, /I confirm I already submitted this application on the employer site/);
  assert.match(client, /This does not open, fill, click or submit the employer form/);
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /"\/api\/application-progress"/);
  assert.match(client, /mark_external_submission/);
  assert.match(client, /clear_external_submission/);
  assert.doesNotMatch(client, /requestSubmit\(|\.submit\(\)|document\.querySelector/);
});

test("recorded external submission disables both new and already-minted Safe Fill handoffs", async () => {
  const [mintRoute, exchangeRoute, assist] = await Promise.all([
    readFile(new URL("../app/api/applications/browser-task/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/applications/browser-task/exchange/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/assist/assist-client.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(mintRoute, /isNull\(applications\.submittedAt\)/);
  assert.match(exchangeRoute, /isNull\(applications\.submittedAt\)/);
  assert.match(assist, /item\.status === "ready_for_review" && !item\.submittedAt/);
});
