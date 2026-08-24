import { parseOutreachDraftForEmail, type ParsedOutreachDraft } from "./gmail-compose.ts";

const GMAIL_DRAFT_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
const REVISION_ID = /^[A-Za-z0-9._:-]{3,160}$/;

export const GMAIL_DRAFT_API_CAPABILITIES = Object.freeze({
  createDraft: true,
  updateDraft: false,
  sendEmail: false,
  sendDraft: false,
  deleteDraft: false,
  arbitraryGmailRequest: false,
} as const);

function cleanLine(value: string, field: string, max: number) {
  const candidate = value.trim();
  if (!candidate || candidate.length > max || /[\r\n\0]/.test(value)) throw new Error(`${field} is invalid`);
  return candidate;
}

function cleanBody(value: string) {
  const candidate = value.replace(/\r\n/g, "\n").trim();
  if (!candidate || candidate.length > 20_000 || candidate.includes("\0")) throw new Error("Email body is invalid");
  return candidate;
}

function cleanRecipient(value: string) {
  const email = cleanLine(value, "Recipient", 320).toLowerCase();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) throw new Error("Recipient must be one valid email address");
  return email;
}

function encodeSubject(value: string) {
  const subject = cleanLine(value, "Subject", 180);
  if (/^[\x20-\x7e]+$/.test(subject)) return subject;
  const bytes = new TextEncoder().encode(subject);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function base64UrlUtf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildGmailDraftRawMessage(input: ParsedOutreachDraft & { scoutRevisionId: string }) {
  const to = cleanRecipient(input.to);
  const subject = encodeSubject(input.subject);
  const body = cleanBody(input.body);
  const scoutRevisionId = cleanLine(input.scoutRevisionId, "Scout revision id", 160);
  if (!REVISION_ID.test(scoutRevisionId)) throw new Error("Scout revision id is invalid");
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    `X-Scout-Revision-ID: ${scoutRevisionId}`,
    "",
    body,
  ].join("\r\n");
  return base64UrlUtf8(message);
}

export function buildGmailDraftFromOutreach(value: string, scoutRevisionId: string) {
  const parsed = parseOutreachDraftForEmail(value);
  return { parsed, raw: buildGmailDraftRawMessage({ ...parsed, scoutRevisionId }) };
}

export function createGmailDraftClient(options: { accessToken: string; fetcher?: typeof fetch }) {
  const accessToken = cleanLine(options.accessToken, "Gmail OAuth access token", 8192);
  if (accessToken.length < 16) throw new Error("Gmail OAuth access token is invalid");
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async createDraft(input: ParsedOutreachDraft & { scoutRevisionId: string }) {
      const raw = buildGmailDraftRawMessage(input);
      const response = await fetcher(GMAIL_DRAFT_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ message: { raw } }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Gmail draft creation failed (${response.status})`);
      const value = await response.json() as { id?: unknown; message?: { id?: unknown; threadId?: unknown } };
      if (typeof value.id !== "string" || !value.id.trim()) throw new Error("Gmail draft response is missing the draft id");
      if (!value.message || typeof value.message.id !== "string" || !value.message.id.trim()) throw new Error("Gmail draft response is missing the message id");
      return {
        draftId: value.id.trim(),
        messageId: value.message.id.trim(),
        threadId: typeof value.message.threadId === "string" ? value.message.threadId.trim() || null : null,
      };
    },
  });
}
