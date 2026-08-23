# Scout Application Action Queue slice

This slice continues the already-applied Claims, local demo DB and local-dev auth fixes.

## Adds

- Application Profile UI + owner-only API using the existing `profile_evidence` table.
- Application preparation queue using the existing `applications` table; it does not submit anything.
- Deterministic application-channel classification for Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Internshala, Unstop, Wellfound, LinkedIn, Indeed, Naukri and direct company sites.
- Reuses only explicitly verified profile fields.
- Role-specific prep pins approved claim IDs selected from the current resume alignment.
- Sensitive/legal questions remain per-application confirmation items.
- Outreach UI for accepting/rejecting contact evidence and creating customized deterministic drafts.
- One-click Gmail compose URL with To/Subject/Body prefilled. It does not send.
- Outreach template v2: shorter, company/role-specific, and based only on pinned approved claims.

## Apply on Windows PowerShell

From the Scout repo:

```powershell
Expand-Archive "$env:USERPROFILE\Downloads\Scout_Application_Action_Queue.zip" `
  -DestinationPath . -Force
```

Then run:

```powershell
npm run test:unit
npm run lint
python tests/migration-smoke.py
npm run db:generate
npm run build
```

Expected unit test count for this combined slice: 34/34.

## Local run

Keep the local auth variables from the v2 auth fix:

```powershell
$env:SCOUT_LOCAL_DEV_AUTH="1"
$env:SCOUT_LOCAL_DEV_USER_ID="scout-local-owner"
$env:SCOUT_OWNER_USER_ID="scout-local-owner"
npm run dev
```

Open http://localhost:3000/

New tabs: Apply, Outreach, Profile.

## Important behavior

- `Prepare application` only builds/refreshes a local packet. It never submits.
- LinkedIn/Indeed/Naukri are treated as lead sources; Scout asks for the official company/ATS URL before automation.
- Gmail action only opens a prefilled compose window. There is no send worker.
- No CAPTCHA/login/access-control bypass exists.
