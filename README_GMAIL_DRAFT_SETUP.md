# Scout Gmail Draft setup

Scout's Gmail integration is intentionally **draft-only in application code**. The OAuth scope Google offers for composing mail (`https://www.googleapis.com/auth/gmail.compose`) can technically manage drafts **and send mail**, so the scope itself is not the safety boundary. Scout implements `drafts.create` / draft lookup only and does not expose Gmail send methods.

## 1. Create a Google Cloud OAuth client

1. Create or select a Google Cloud project you control.
2. Enable the Gmail API.
3. Configure the OAuth consent screen for your private/test use.
4. Add the Google account you will use with Scout as a test user if the app is in testing mode.
5. Create an OAuth client of type **Desktop app**.
6. Keep the client ID and client secret private. Do not commit them.

Google supports the loopback redirect flow for Windows/macOS/Linux desktop apps. Scout's bootstrap listener binds only to `127.0.0.1` and uses a random local port. It also uses PKCE (`S256`) and an OAuth `state` value.

## 2. Bootstrap the refresh token locally

From PowerShell in the Scout repo:

```powershell
$env:SCOUT_GMAIL_CLIENT_ID="YOUR_DESKTOP_CLIENT_ID"
$env:SCOUT_GMAIL_CLIENT_SECRET="YOUR_DESKTOP_CLIENT_SECRET"
npm run scout:gmail:oauth
```

The script prints a Google authorization URL. Open it in your normal browser and authorize the Google account whose Gmail Drafts should receive Scout drafts.

The script does **not** create an email or Gmail draft. It exchanges the one-time authorization code for a refresh token, does not print that refresh token, and writes the credentials to:

```text
.env.scout-gmail.local
```

`.env*` is ignored by this repository. Treat this file as a secret anyway.

## 3. Configure the hosted agent

When the Scout Node agent is deployed, copy these values into the hosting provider's encrypted secret/config store rather than uploading the local env file:

```text
SCOUT_GMAIL_CLIENT_ID
SCOUT_GMAIL_CLIENT_SECRET
SCOUT_GMAIL_REFRESH_TOKEN
```

Do not commit them to GitHub, put them in a browser bundle, or expose them to the Cloudflare client UI.

## 4. Draft-only behavior

The current Gmail adapter supports:

```text
find existing Scout draft   yes
create Gmail draft           yes
update Gmail draft           no
send Gmail draft             no
send Gmail message           no
delete Gmail draft           no
```

Scout only calls Gmail after an outreach draft is explicitly approved and its approved revision is pinned. A deterministic `Message-ID` based on the Scout revision ID is used to make retries reuse an existing draft where possible.

## Restricted-scope note

`gmail.compose` is a Google restricted scope. A private owner/test setup is different from publishing Scout broadly to other users. A production/public OAuth app may require Google's OAuth verification and, depending on how restricted data is handled, additional security review. Do not turn this private bootstrap into a multi-user public OAuth flow without a separate privacy/security review.

## Revocation

If the refresh token is exposed or you no longer want Scout to access Gmail, revoke the app's Google Account access and remove the Gmail secrets from the agent host. Do not merely delete `.env.scout-gmail.local` and assume the server-side grant is revoked.
