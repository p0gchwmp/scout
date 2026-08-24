import { classifyApplicationUrl } from "./application-sites.ts";

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

const aliases: Record<string, string[]> = {
  full_name: ["full name", "name", "applicant name", "candidate name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "mobile", "mobile number"],
  current_location: ["current location", "location", "city", "current city"],
  university: ["university", "college", "institution", "school"],
  program: ["program", "programme", "course", "degree", "field of study"],
  graduation_year: ["graduation year", "year of graduation", "expected graduation"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile"],
  github_url: ["github", "github url", "github profile"],
  portfolio_url: ["portfolio", "portfolio url", "website", "personal website"],
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
  if (channel.automation === "structured") throw new Error("Structured ATS applications do not need browser fill assistance");
  if (channel.automation === "manual_lead" && !channel.easyApplyAssist) throw new Error("This channel is not approved for browser fill assistance yet");

  const fields = safeFields(packet.safeFields);
  const answers = Object.entries(fields).flatMap(([field, value]) => (aliases[field] ?? []).map((key) => ({
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
