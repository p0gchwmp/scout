import { classifyApplicationUrl } from "./application-sites.ts";
import { PROFILE_AUTOFILL_ALIASES } from "./form-intelligence.ts";

export const BROWSER_TASK_CAPABILITIES = Object.freeze({
  fillVerifiedTextFields: true,
  uploadResume: false,
  answerSensitiveQuestions: false,
  solveCaptcha: false,
  submitApplication: false,
} as const);

type ApplicationPacket = {
  applicationUrl?: unknown;
  safeFields?: unknown;
  channel?: { id?: unknown; automation?: unknown } | null;
};

function packetObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Application packet is invalid");
  return value as ApplicationPacket;
}

function safeFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  const fields: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const clean = raw.trim();
    if (!clean || clean.length > 2000 || clean.includes("\0")) continue;
    fields[key] = clean;
  }
  return fields;
}

export function buildBrowserAssistTask(input: {
  applicationId: string;
  artifactVersion: number;
  packet: unknown;
  now?: number;
}) {
  const packet = packetObject(input.packet);
  if (typeof packet.applicationUrl !== "string") throw new Error("Application URL is missing");
  const url = new URL(packet.applicationUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Application URL is unsupported");
  const channel = classifyApplicationUrl(url.href);
  // Structured ATS classification describes Scout's discovery/resolution path. It must not
  // prevent reviewed browser-side Safe Fill on the visible candidate form. Submission,
  // CAPTCHA solving, file upload and sensitive answers remain unavailable below.
  if (channel.automation === "manual_lead" && !channel.easyApplyAssist) throw new Error("This channel is not approved for browser fill assistance yet");

  const fields = safeFields(packet.safeFields);
  const answers = Object.entries(fields).flatMap(([field, value]) => (PROFILE_AUTOFILL_ALIASES[field] ?? []).map((key) => ({
    key,
    value,
    verified: true as const,
    sourceField: field,
  })));
  if (!answers.length) throw new Error("No verified reusable fields are available for browser assistance");

  const now = input.now ?? Date.now();
  if (!Number.isInteger(input.artifactVersion) || input.artifactVersion < 1) throw new Error("Application artifact version is invalid");
  return {
    schemaVersion: 1 as const,
    applicationId: input.applicationId,
    artifactVersion: input.artifactVersion,
    allowedDomain: url.hostname,
    allowedUrl: `${url.origin}${url.pathname}`,
    platformId: channel.id,
    answers,
    issuedAt: now,
    expiresAt: now + 10 * 60_000,
    constraints: {
      sensitiveQuestionsRequireReview: true as const,
      captchaManualOnly: true as const,
      submitAvailable: false as const,
      fileUploadAvailable: false as const,
    },
  };
}
