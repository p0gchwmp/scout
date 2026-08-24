export type ParsedOutreachDraft = { to: string; subject: string; body: string };

export function parseOutreachDraftForEmail(value: string): ParsedOutreachDraft {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (!lines[0]?.startsWith("To: ") || !lines[1]?.startsWith("Subject: ")) throw new Error("Draft is missing pinned email headers");
  const to = lines[0].slice(4).trim();
  const subject = lines[1].slice(9).trim();
  const bodyStart = lines[2] === "" ? 3 : 2;
  const body = lines.slice(bodyStart).join("\n").trim();
  if (!to || !subject || !body) throw new Error("Draft is incomplete");
  return { to, subject, body };
}

function normalizedDraft(value: string | ParsedOutreachDraft): ParsedOutreachDraft {
  const draft = typeof value === "string" ? parseOutreachDraftForEmail(value) : value;
  const to = draft.to.trim();
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  if (!to || !subject || !body || /[\r\n]/.test(to) || /[\r\n]/.test(subject)) throw new Error("Draft is incomplete");
  return { to, subject, body };
}

export function gmailComposeUrl(value: string | ParsedOutreachDraft) {
  const draft = normalizedDraft(value);
  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("to", draft.to);
  url.searchParams.set("su", draft.subject);
  url.searchParams.set("body", draft.body);
  return url.href;
}
