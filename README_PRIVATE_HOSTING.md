# Scout private-hosting readiness

Scout can be prepared for private hosting, but **this document does not authorize deployment**. Deployment still requires an explicit owner decision after the current release gate and hosted configuration are reviewed.

## Preflight

From a clean current checkout:

```bash
npm ci
npm run verify:release
npm run hosting:doctor
```

`hosting:doctor` is read-only. It checks configuration shape only and never prints secret values. It blocks when `SCOUT_OWNER_USER_ID` is absent, when local-development authentication/secrets leak into a hosted environment, or when the required `DB` hosting binding is missing.

Optional cloud-agent configuration is reported separately. If configured, `SCOUT_AGENT_BASE_URL` must be a public HTTPS origin and `SCOUT_AGENT_SHARED_SECRET` must be a 64-character hex secret. The loopback-development override must remain disabled in hosting.

## After an explicitly approved deployment

Use the existing owner-authenticated, read-only endpoints:

- `/api/health`
- `/api/runtime-readiness`

Then perform the manual smoke checklist in `README_DEPLOY_READINESS.md`.

## Still unavailable by design

Private hosting does not authorize or enable:

- automatic application submission;
- automatic email sending;
- CAPTCHA/login bypass;
- private recruiter-data scraping;
- guessed email addresses;
- paid-provider activation or overage;
- automatic contact acceptance or outreach approval.

The hosted application must remain owner-only and fail closed if the owner identity is not configured correctly.
