const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const GMAIL_DRAFT_CAPABILITIES = Object.freeze({
  createDraft: true,
  findExistingDraft: true,
  updateDraft: false,
  sendDraft: false,
  sendMessage: false,
  deleteDraft: false,
} as const);

export type GmailDraftInput = {
  revisionId: string;
  to: string;
  subject: string;
  body: string;
};

export type GmailDraftResult = {
  draftId: string;
  messageId: string;
  scoutMessageId: string;
  reused: boolean;
};

function oneLine(value: string, field: string, max: number) {
  const candidate = value.trim();
  if (!candidate || candidate.length > max || /[\r\n\0]/.test(value)) throw new Error(`${field} is invalid`);
  return candidate;
}

function bodyText(value: string) {
  const candidate = value.trim();
  if (!candidate || candidate.length > 20_000 || candidate.includes("\0")) throw new Error("Gmail draft body is invalid");
  return candidate;
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeHeader(value: string) {
  return /[^\x20-\x7e]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

export function buildScoutGmailMessage(input: GmailDraftInput) {
  const revisionId = oneLine(input.revisionId, "Revision id", 160);
  const to = oneLine(input.to, "Recipient", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Recipient is invalid");
  const subject = oneLine(input.subject, "Subject", 180);
  const body = bodyText(input.body);
  const scoutMessageId = `<scout-${revisionId}@drafts.scout.invalid>`;
  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Message-ID: ${scoutMessageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  return { raw: base64Url(mime), scoutMessageId, to, subject, body };
}

async function accessToken(fetcher: typeof fetch) {
  const clientId = process.env.SCOUT_GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.SCOUT_GMAIL_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = process.env.SCOUT_GMAIL_REFRESH_TOKEN?.trim() ?? "";
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Scout Gmail OAuth is not configured");

  const response = await fetcher(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Gmail OAuth refresh failed (${response.status})`);
  const payload = await response.json() as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token.trim()) throw new Error("Gmail OAuth refresh returned no access token");
  return payload.access_token.trim();
}

async function gmailJson(fetcher: typeof fetch, token: string, url: string, init?: RequestInit) {
  const response = await fetcher(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Gmail API request failed (${response.status})`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function createOrReuseGmailDraft(input: GmailDraftInput, fetcher: typeof fetch = fetch): Promise<GmailDraftResult> {
  const message = buildScoutGmailMessage(input);
  const token = await accessToken(fetcher);
  const query = encodeURIComponent(`rfc822msgid:${message.scoutMessageId}`);
  const existing = await gmailJson(fetcher, token, `${GMAIL_API}/drafts?q=${query}&maxResults=2`);
  const drafts = Array.isArray(existing.drafts) ? existing.drafts as Array<Record<string, unknown>> : [];
  if (drafts.length) {
    const draftId = String(drafts[0]?.id ?? "").trim();
    const messageId = String((drafts[0]?.message as Record<string, unknown> | undefined)?.id ?? "").trim();
    if (draftId) return { draftId, messageId, scoutMessageId: message.scoutMessageId, reused: true };
  }

  const created = await gmailJson(fetcher, token, `${GMAIL_API}/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw: message.raw } }),
  });
  const draftId = String(created.id ?? "").trim();
  const messageId = String((created.message as Record<string, unknown> | undefined)?.id ?? "").trim();
  if (!draftId) throw new Error("Gmail draft creation returned no draft id");
  return { draftId, messageId, scoutMessageId: message.scoutMessageId, reused: false };
}
