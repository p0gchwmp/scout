import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GREENHOUSE_FETCH_FIELDS,
  calculateFitScore,
  determineAutomationState,
  extractStrongEvidence,
  validateGreenhouseEvidenceUrl,
} from "../lib/scout.ts";
import {
  INTAKE_CAPABILITIES,
  createManualLead,
} from "../lib/scout/intake.ts";
import { DISCOVERY_SOURCES } from "../lib/scout/lead-discovery.ts";
import { resolveControlledLead } from "../lib/scout/lead-resolution.ts";
import { resolveAgentLead } from "../lib/scout/lead-resolution-agent-client.ts";
import { evaluateResumeAlignment } from "../lib/scout/resume-alignment.ts";
import { buildApplicationPreparation } from "../lib/scout/application-prep.ts";
import { parseApplicationPreparePayload, parseProfileReviewPayload, parseProfileUpsertPayload } from "../lib/scout/api-validation.ts";
import {
  CLAIM_CAPABILITIES,
  approveClaim,
  editClaim,
  rejectClaim,
} from "../lib/scout/claims.ts";
import {
  createDraft,
  reviseDraft,
  approveDraft,
  rejectDraft,
  OUTREACH_CAPABILITIES,
  renderOutreachDraft,
} from "../lib/scout/outreach.ts";
import {
  extractPublishedBusinessEmails,
  isOfficialJobEvidenceUrl,
} from "../lib/scout/contact-extraction.ts";
import { gmailComposeUrl } from "../lib/scout/gmail-compose.ts";
import { upsertGreenhouseJob, syncGreenhouseSource, type GreenhouseFetch } from "../lib/scout/sync.ts";

// ... existing file content above this excerpt is unchanged in the repository.
