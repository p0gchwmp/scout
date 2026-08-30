import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OPPORTUNITY_COMMAND_CENTER_CAPABILITIES } from "../lib/scout/opportunity-command-center.ts";

test("command center expands safe research/draft capability without send or submit", () => {
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.researchPublicRecruitingContacts, true);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.seedRecruitingTargetsByExplicitOwnerAction, true);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.createGmailDraftAfterExactApproval, true);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.sendEmail, false);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.submitApplication, false);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.autoAcceptContact, false);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.autoRegisterSource, false);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.autoRejectOpportunity, false);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.portfolioBoardsRemainLeadOnly, true);
  assert.equal(OPPORTUNITY_COMMAND_CENTER_CAPABILITIES.ecosystemSearchResultsRemainEphemeral, true);
});

test("command-center client can research ecosystem contacts and create approved Gmail drafts only", async () => {
  const source = await readFile(new URL("../app/command-center/command-center-client.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/ecosystem/);
  assert.match(source, /"discover" \| "seed_recruiting_targets" \| "research_public_contacts"/);
  assert.match(source, /\/api\/agent\/create-gmail-draft/);
  assert.match(source, /draft\.state === "approved" && draft\.approvedRevisionId/);
  assert.match(source, /Nothing was sent/);
  assert.doesNotMatch(source, /messages\.send|drafts\.send|action:\s*"submit"|submitApplication\s*:\s*true|sendEmail\s*:\s*true/);
});

test("owner-only page uses Scout page authorization", async () => {
  const source = await readFile(new URL("../app/command-center/page.tsx", import.meta.url), "utf8");
  assert.match(source, /requireChatGPTUser/);
  assert.match(source, /requireScoutPageOwner/);
});
