# Scout — Resume Profile/Claims + Customized Cover Letter Implementation

Prepared from the current production-facing Scout architecture at GitHub `main` SHA `23f28cbcde10248afb3c6c07e4f15feb961f0339`.

## What this adds

### 1. Safe resume import

New owner-only page: `/resume-import`

- User chooses a JSON import file locally in the browser.
- The server accepts only a strict, versioned resume-import schema.
- Imported profile fields stay **unverified** unless an identical already-verified value exists.
- Imported resume claims stay **draft**.
- A verified profile value cannot be silently overwritten by a different resume value.
- Duplicate claims are skipped.
- No application submission, email send, or automatic claim approval is added.

`Ryan_Vivek_Mahajan_resume_import.json` contains the profile fields and 16 draft claims extracted from the user-approved 2026 resume. It uses CGPA **8.06/10 (Semester I)** and preserves the AI-assisted/prototype and NHM pilot boundaries.

### 2. Role-aware customized cover letter

New helper: `lib/scout/cover-letter.ts`

- Produces a one-page review-range cover letter.
- Uses at most **two approved evidence examples**.
- Public-policy/public-health contexts prioritize NHM/GMC/AMR/ADR evidence.
- Consumer/startup contexts prioritize Copium where relevant.
- Product/operations contexts prioritize Aastha/Scout/product-workflow evidence.
- Uses only supplied approved claims; it does not invent metrics, credentials, results, eligibility, availability, or referrals.
- Leaves no `[[template placeholders]]` in output.

### 3. Email + cover letter as one immutable reviewed revision

The existing job outreach, AI-auto outreach, and company-first outreach routes now generate:

1. the short personalized email; then
2. a clearly marked `Cover letter` section underneath it.

Both are stored in the **same existing immutable revision body**. This intentionally avoids a database migration and preserves the current body hash / evidence pinning model.

The existing Gmail draft path already uses all body text after `To:` and `Subject:`, so after Ryan approves the exact revision, the Gmail draft contains the short email plus the customized cover letter inline.

**This implementation does not create a PDF attachment.** It creates the cover letter inline in the reviewed Gmail draft. Sending remains manual.

## Files

New:
- `lib/scout/resume-import.ts`
- `lib/scout/cover-letter.ts`
- `app/api/resume-import/route.ts`
- `app/resume-import/page.tsx`
- `app/resume-import/resume-import-client.tsx`
- `tests/resume-cover-letter.test.ts`
- `Ryan_Vivek_Mahajan_resume_import.json` (deployment/import data, not application code)

Modified replacements based on exact current-main versions:
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

## Verification performed in this environment

- Targeted tests: **5/5 passed** with Node `--experimental-strip-types`.
- Targeted ESLint on all proposed TS/TSX files: **passed** using the installed ESLint JS entry point in the uploaded repository copy.
- The uploaded repository ZIP is older than current GitHub `main`, so a truthful full current-main `npm test` / migration / db generate / build release gate was **not** possible without committing the patch to a GitHub branch and letting exact-head CI run.
- Earlier pre-edit checks on the uploaded old repository copy: `npm run test:unit` passed **19/19**; its `npm run lint` shell wrapper failed with `eslint: Permission denied`, while direct Node invocation of ESLint works.

## Recommended integration sequence

1. Put these files on a feature branch based on current `main`.
2. Run exact-head Scout CI and the full release gate.
3. Merge only after green CI and explicit user approval.
4. Deploy only after separate explicit deployment approval.
5. Open `/resume-import`, choose `Ryan_Vivek_Mahajan_resume_import.json`, import.
6. Review/verify Profile fields and approve/reject Claims.
7. Run Scout. For an accepted public contact, create outreach and review the exact email + cover letter revision.
8. Create Gmail draft only after approval; manually send if desired.
