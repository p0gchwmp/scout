import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_EXECUTION_CAPABILITIES, AGENT_TASK_TYPES, planAgentTasks } from "../lib/scout/agent-task-planner.ts";

test("agent planner routes job boards to official resolution before application automation", () => {
  for (const url of [
    "https://www.linkedin.com/jobs/view/123",
    "https://internshala.com/internship/detail/test",
    "https://www.glassdoor.co.in/job-listing/test",
    "https://www.naukri.com/job-listings-test-1",
  ]) {
    const plan = planAgentTasks({ url, hasOfficialSnapshot: false, applicationPrepared: false, hasAcceptedContact: false, outreachDraftReady: false, gmailDraftCreated: false });
    assert.deepEqual(plan.map((item) => item.type), ["resolve_official_posting"]);
  }
});

test("agent planner handles structured and browser-assisted ATS differently", () => {
  const greenhouse = planAgentTasks({ url: "https://job-boards.greenhouse.io/acme/jobs/123", hasOfficialSnapshot: true, applicationPrepared: false, hasAcceptedContact: false, outreachDraftReady: false, gmailDraftCreated: false });
  assert.equal(greenhouse[0].type, "prepare_application");
  assert.equal(greenhouse[0].requiresReview, false);

  const workday = planAgentTasks({ url: "https://acme.wd5.myworkdayjobs.com/careers/job/123", hasOfficialSnapshot: true, applicationPrepared: false, hasAcceptedContact: false, outreachDraftReady: false, gmailDraftCreated: false });
  assert.equal(workday[0].type, "browser_assist_application");
  assert.equal(workday[0].requiresReview, true);
});

test("agent planner progresses from contact research to AI outreach and Gmail draft", () => {
  const base = { url: "https://jobs.lever.co/acme/123", hasOfficialSnapshot: true, applicationPrepared: true };
  assert.equal(planAgentTasks({ ...base, hasAcceptedContact: false, outreachDraftReady: false, gmailDraftCreated: false })[0].type, "research_contacts");
  assert.equal(planAgentTasks({ ...base, hasAcceptedContact: true, outreachDraftReady: false, gmailDraftCreated: false })[0].type, "draft_outreach");
  assert.equal(planAgentTasks({ ...base, hasAcceptedContact: true, outreachDraftReady: true, gmailDraftCreated: false })[0].type, "create_gmail_draft");
  assert.deepEqual(planAgentTasks({ ...base, hasAcceptedContact: true, outreachDraftReady: true, gmailDraftCreated: true }), []);
});

test("agent task vocabulary cannot send email or submit applications", () => {
  assert.equal(AGENT_EXECUTION_CAPABILITIES.sendEmail, false);
  assert.equal(AGENT_EXECUTION_CAPABILITIES.submitApplication, false);
  assert.equal(AGENT_EXECUTION_CAPABILITIES.bypassAccessControls, false);
  assert.equal(AGENT_TASK_TYPES.some((task) => /send|submit/.test(task)), false);
});
