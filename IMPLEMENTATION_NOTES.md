# Scout — Resume Profile/Claims + Customized Cover Letter Implementation

The resume-backed profile/claims and customized cover-letter workflow is implemented on Scout's production-facing `main` branch.

## What this adds

### 1. Safe resume import

Owner-only page: `/resume-import`

- User chooses a JSON import file locally in the browser.
- The server accepts only a strict, versioned resume-import schema.
- Imported profile fields stay **unverified** unless an identical already-verified value exists.
- Imported resume claims stay **draft**.
- A verified profile value cannot be silently overwritten by a different resume value.
- Duplicate claims are skipped.
- No application submission, email send, or automatic claim approval is added.

The candidate-specific resume import JSON is intentionally **not stored in source control**. Keep it as a private user-held artifact and upload it through `/resume-import`. The currently prepared import uses CGPA **8.06/10 (Semester I)** and preserves the AI-assisted/prototype and NHM pilot boundaries.

### 2. Role-aware customized cover letter

Helper: `lib/scout/cover-letter.ts`

- Produces a one-page review-range cover letter.
- Uses at most **two approved evidence examples**.
- Public-policy/public-health contexts prioritize NHM/GMC/AMR/ADR evidence.
- Consumer/startup contexts prioritize Copium where relevant.
- Product/operations contexts prioritize Aastha/Scout/product-workflow evidence.
- Uses only supplied approved claims; it does not invent metrics, credentials, results, eligibility, availability, or referrals.
- Leaves no `[[template placeholders]]` in output.

### 3. Email + cover letter as one immutable reviewed revision

The existing job outreach, AI-auto outreach, and company-first outreach routes generate:

1. the short personalized email; then
2. a clearly marked `Cover letter` section underneath it.

Both are stored in the **same existing immutable revision body**. This intentionally avoids a database migration and preserves the current body hash / evidence pinning model.

The reviewed Gmail draft path uses all body text after `To:` and `Subject:`, so after Ryan approves the exact revision, the Gmail draft contains the short email plus the customized cover letter inline.

**This implementation does not create a PDF attachment.** It creates the cover letter inline in the reviewed Gmail draft. Sending remains manual.

## Files

Resume-import / cover-letter code:
- `lib/scout/resume-import.ts`
- `lib/scout/cover-letter.ts`
- `app/api/resume-import/route.ts`
- `app/resume-import/page.tsx`
- `app/resume-import/resume-import-client.tsx`
- `tests/resume-cover-letter.test.ts`

Outreach integration:
- `lib/scout/outreach.ts`
- `app/api/outreach/route.ts`
- `app/api/agent/draft-outreach/auto/route.ts`
- `app/api/company-outreach/drafts/route.ts`

## Safety behavior

Unchanged:
- Scout is owner-only.
- Mutations require same-origin checks.
- Contacts still require accepted published evidence.
- Drafts remain pinned to the relevant contact/job/company target and approved claim IDs.
- Gmail creation still requires exact draft approval.
- `sendEmail: false` and `submitApplication: false` remain intact.
- No guessed emails, LinkedIn private-email scraping, paid services, auto-send, or auto-submit were added.

## Verification

The integration was validated through exact-head GitHub Scout CI before merge and again on the merged `main` release. Future changes must use the same exact-head CI/release-gate process when a current-main local shell is unavailable.

## Production workflow

1. Deploy the green `main` release.
2. Open `/resume-import` and choose the private candidate resume-import JSON held outside source control.
3. Import as unverified profile evidence + draft claims.
4. Review/verify Profile fields and approve/reject Claims.
5. Run Scout. For an accepted public contact, create outreach and review the exact email + cover-letter revision.
6. Create a Gmail draft only after approval; manually send if desired.
