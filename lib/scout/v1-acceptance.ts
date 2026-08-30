export const SCOUT_V1_ACCEPTANCE = Object.freeze({
  release: "scout-v1",
  workflow: Object.freeze({
    discoverControlledAndSearchLeads: true,
    preserveOfficialImmutableEvidence: true,
    promoteLeadsOnlyAfterOfficialResolution: true,
    rankWithEvidenceAndReadiness: true,
    researchPublishedBusinessContacts: true,
    requireHumanContactAcceptance: true,
    draftOutreachFromApprovedClaims: true,
    requireExactOutreachRevisionApproval: true,
    createGmailDraftAfterApproval: true,
    safeFillWithCurrentSnapshotAndProfileBindings: true,
    recordManualSubmissionAndOutcomes: true,
    oneRunOrchestration: true,
  }),
  safety: Object.freeze({
    ownerOnly: true,
    failClosedWithoutOwnerId: true,
    sameOriginBrowserMutations: true,
    immutableJobSnapshots: true,
    approvedClaimsImmutable: true,
    outreachEvidencePinned: true,
    searchResultsAreNotTrustedEvidence: true,
    newContactsNeedReview: true,
    guessEmails: false,
    scrapePersonalContacts: false,
    bypassCaptchaOrLogin: false,
    autoAcceptContact: false,
    autoApproveOutreach: false,
    sendEmail: false,
    submitApplication: false,
  }),
} as const);

export function scoutV1AcceptanceIssues(manifest = SCOUT_V1_ACCEPTANCE) {
  const issues: string[] = [];
  for (const [name, enabled] of Object.entries(manifest.workflow)) {
    if (enabled !== true) issues.push(`required workflow capability disabled: ${name}`);
  }
  for (const name of [
    "ownerOnly",
    "failClosedWithoutOwnerId",
    "sameOriginBrowserMutations",
    "immutableJobSnapshots",
    "approvedClaimsImmutable",
    "outreachEvidencePinned",
    "searchResultsAreNotTrustedEvidence",
    "newContactsNeedReview",
  ] as const) {
    if (manifest.safety[name] !== true) issues.push(`required safety invariant disabled: ${name}`);
  }
  for (const name of [
    "guessEmails",
    "scrapePersonalContacts",
    "bypassCaptchaOrLogin",
    "autoAcceptContact",
    "autoApproveOutreach",
    "sendEmail",
    "submitApplication",
  ] as const) {
    if (manifest.safety[name] !== false) issues.push(`prohibited autonomous capability enabled: ${name}`);
  }
  return issues;
}
