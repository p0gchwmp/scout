# Scout Local Dev Auth Fix v2

This replaces the first local-auth patch.

## Why v1 failed

Vinext dev runs Scout through the Cloudflare Worker/Vite runtime. PowerShell environment variables are available to `vite.config.ts`, but they are not reliably exposed as `process.env` inside the RSC/Worker runtime. The v1 fallback therefore never saw `SCOUT_LOCAL_DEV_AUTH=1` and `/` kept redirecting to `/signin-with-chatgpt`.

## What v2 does

- `vite.config.ts` reads the three explicit shell variables during `vite serve` only.
- It passes them to the local Cloudflare Worker as local-only bindings plus an internal `SCOUT_LOCAL_DEV_RUNTIME=1` marker.
- `worker/index.ts` accepts the synthetic identity only for loopback request URLs/hosts and only when the local-runtime marker, explicit auth flag, and matching owner/user IDs are present.
- The worker injects the same authenticated-user headers that the app already trusts in hosted mode.
- `app/chatgpt-auth.ts` is restored to hosted-header-only behavior; there is no second hidden auth fallback in the RSC layer.
- Production builds/deploys do not receive the local-runtime marker from Vite config.

## Apply

Extract this ZIP over the Scout repository root, then run:

```powershell
npm run test:unit
npm run lint
python tests/migration-smoke.py
```

Expected combined unit result for the slice used to build this patch: 31/31 passing.

## Run locally

```powershell
$env:SCOUT_LOCAL_DEV_AUTH="1"
$env:SCOUT_LOCAL_DEV_USER_ID="scout-local-owner"
$env:SCOUT_OWNER_USER_ID="scout-local-owner"

npm run dev
```

Open `http://localhost:3000/`.

If the IDs are absent or mismatched, Vinext startup now fails with a clear configuration error instead of silently falling through to the hosted sign-in redirect.

## Cleanup

```powershell
Remove-Item Env:SCOUT_LOCAL_DEV_AUTH -ErrorAction SilentlyContinue
Remove-Item Env:SCOUT_LOCAL_DEV_USER_ID -ErrorAction SilentlyContinue
Remove-Item Env:SCOUT_OWNER_USER_ID -ErrorAction SilentlyContinue
```
