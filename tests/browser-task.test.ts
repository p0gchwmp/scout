import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { BROWSER_TASK_CAPABILITIES, buildBrowserAssistTask } from "../lib/scout/browser-task.ts";

test("browser task expands verified profile keys into conservative visible form-label aliases", () => {
  const now = 1_800_000_000_000;
  const task = buildBrowserAssistTask({
    applicationId: "application-1",
    artifactVersion: 3,
    now,
    packet: {
      applicationUrl: "https://tally.so/r/example?utm_source=scout",
      safeFields: {
        full_name: "Ryan Mahajan",
        email: "ryan@example.com",
        university: "IIM Sambalpur",
        program: "Management & Public Policy",
        resume_reference: "resume-v3.pdf",
      },
    },
  });
  assert.equal(task.platformId, "tally");
  assert.equal(task.allowedDomain, "tally.so");
  assert.equal(task.allowedUrl, "https://tally.so/r/example");
  assert.equal(task.expiresAt, now + 10 * 60_000);
  assert.ok(task.answers.some((answer) => answer.key === "full name" && answer.value === "Ryan Mahajan"));
  assert.ok(task.answers.some((answer) => answer.key === "university" && answer.value === "IIM Sambalpur"));
  assert.ok(task.answers.some((answer) => answer.key === "degree program" && answer.value === "Management & Public Policy"));
  assert.equal(task.answers.some((answer) => answer.key === "degree"), false);
  assert.equal(task.answers.some((answer) => answer.sourceField === "resume_reference"), false);
  assert.equal(task.constraints.submitAvailable, false);
  assert.equal(task.constraints.captchaManualOnly, true);
});

test("browser task allows reviewed Safe Fill on structured ATS while refusing unresolved manual-lead channels", () => {
  const greenhouse = buildBrowserAssistTask({
    applicationId: "app-greenhouse",
    artifactVersion: 1,
    packet: {
      applicationUrl: "https://job-boards.greenhouse.io/fourkites/jobs/123",
      safeFields: { email: "ryan@example.com" },
    },
  });
  assert.equal(greenhouse.platformId, "greenhouse");
  assert.equal(greenhouse.constraints.submitAvailable, false);
  assert.equal(greenhouse.constraints.fileUploadAvailable, false);

  const lever = buildBrowserAssistTask({
    applicationId: "app-lever",
    artifactVersion: 1,
    packet: {
      applicationUrl: "https://jobs.lever.co/Sprinto/example-role/apply",
      safeFields: { email: "ryan@example.com" },
    },
  });
  assert.equal(lever.platformId, "lever");
  assert.equal(lever.allowedDomain, "jobs.lever.co");
  assert.equal(lever.constraints.submitAvailable, false);
  assert.equal(lever.constraints.captchaManualOnly, true);

  assert.throws(() => buildBrowserAssistTask({ applicationId: "app-manual", artifactVersion: 1, packet: { applicationUrl: "https://www.glassdoor.com/job-listing/test", safeFields: { email: "a@b.com" } } }), /not approved for browser fill/i);
});

test("browser assist capability surface has no submit/captcha/file automation", () => {
  assert.equal(BROWSER_TASK_CAPABILITIES.fillVerifiedTextFields, true);
  assert.equal(BROWSER_TASK_CAPABILITIES.submitApplication, false);
  assert.equal(BROWSER_TASK_CAPABILITIES.solveCaptcha, false);
  assert.equal(BROWSER_TASK_CAPABILITIES.uploadResume, false);
  assert.equal(BROWSER_TASK_CAPABILITIES.answerSensitiveQuestions, false);
});

test("browser task route is owner-only, same-origin and ready-for-review gated", async () => {
  const route = await readFile(new URL("../app/api/applications/browser-task/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireScoutApiUser\(\)/);
  assert.match(route, /requireSameOriginMutation\(request\)/);
  assert.match(route, /eq\(applications\.status, "ready_for_review"\)/);
  assert.match(route, /buildBrowserAssistTask/);
  assert.doesNotMatch(route, /submitApplication\(\)|click\(.*submit|captcha.*solve/i);
});
