import { isSensitiveApplicationQuestion, type ApplicationQuestion } from "./ai-agent.ts";

export const FORM_INTELLIGENCE_CAPABILITIES = Object.freeze({
  classifyVisibleFields: true,
  fillVerifiedProfileFields: true,
  draftFromApprovedClaims: true,
  answerSensitiveQuestions: false,
  inferUnknownAnswers: false,
  uploadFiles: false,
  solveCaptcha: false,
  submitApplication: false,
} as const);

export type FormFieldCategory =
  | "safe_autofill"
  | "draft_from_claims"
  | "needs_user_answer"
  | "sensitive_manual"
  | "unsupported_manual";

export type ObservedFormField = {
  id: string;
  label: string;
  controlKind: "input" | "textarea" | "select";
  inputType: string;
  maxLength: number | null;
  required: boolean;
};

export type ClassifiedFormField = ObservedFormField & {
  category: FormFieldCategory;
  reason: string;
  sourceField: string | null;
};

export const PROFILE_AUTOFILL_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  full_name: ["full name", "applicant name", "candidate name", "name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "mobile", "mobile number"],
  current_location: ["current location", "current city", "city", "location"],
  university: ["university", "college", "institution", "school"],
  program: ["program", "programme", "course", "degree program", "degree programme", "field of study"],
  graduation_year: ["graduation year", "year of graduation", "expected graduation", "expected graduation year"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile"],
  github_url: ["github", "github url", "github profile"],
  portfolio_url: ["portfolio", "portfolio url", "personal website", "website"],
});

function singleLine(value: unknown, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > max || /[\r\n\0]/.test(value)) throw new Error(`${field} is invalid`);
  return clean;
}

export function normalizeFormLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/\(required\)/g, " ")
    .replace(/\brequired\b\s*$/g, " ")
    .replace(/[?:*]+$/g, " ")
    .replace(/^please\s+(?:enter|provide|add)\s+(?:your\s+)?/g, "")
    .replace(/^what\s+is\s+(?:your\s+)?/g, "")
    .replace(/^your\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function profileFieldForLabel(label: string) {
  const normalized = normalizeFormLabel(label);
  for (const [sourceField, aliases] of Object.entries(PROFILE_AUTOFILL_ALIASES)) {
    if (aliases.includes(normalized)) return sourceField;
  }
  return null;
}

export function parseObservedFormFields(value: unknown): ObservedFormField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40) throw new Error("Too many visible application fields");
  const fields = value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Application field ${index + 1} is invalid`);
    const record = raw as Record<string, unknown>;
    const controlKind = record.controlKind;
    if (controlKind !== "input" && controlKind !== "textarea" && controlKind !== "select") throw new Error(`Application field ${index + 1} control is invalid`);
    const inputType = controlKind === "input" ? singleLine(record.inputType ?? "text", "Application input type", 50).toLowerCase() : controlKind;
    let maxLength: number | null = null;
    if (record.maxLength !== null && record.maxLength !== undefined) {
      const parsed = Number(record.maxLength);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) throw new Error("Application field maxLength is invalid");
      maxLength = parsed;
    }
    return {
      id: singleLine(record.id, "Application field id", 200),
      label: singleLine(record.label, "Application field label", 1000),
      controlKind,
      inputType,
      maxLength,
      required: record.required === true,
    } satisfies ObservedFormField;
  });
  if (new Set(fields.map((field) => field.id)).size !== fields.length) throw new Error("Application field ids must be unique");
  return fields;
}

export function classifyFormField(field: ObservedFormField): ClassifiedFormField {
  const sourceField = profileFieldForLabel(field.label);
  if (field.inputType === "password" || isSensitiveApplicationQuestion(field.label)) {
    return { ...field, category: "sensitive_manual", sourceField: null, reason: "Sensitive or per-application confirmation required" };
  }
  if (field.inputType === "file") {
    return { ...field, category: "unsupported_manual", sourceField: null, reason: "File uploads stay manual" };
  }
  if (field.inputType === "checkbox" || field.inputType === "radio") {
    return { ...field, category: "needs_user_answer", sourceField: null, reason: "Choice controls require an explicit user decision" };
  }
  if (sourceField) {
    return { ...field, category: "safe_autofill", sourceField, reason: `Fill only from verified profile field ${sourceField}` };
  }
  const freeText = field.controlKind === "textarea"
    || (field.controlKind === "input" && (field.inputType === "text" || field.inputType === "search") && (field.maxLength === null || field.maxLength >= 40));
  if (freeText) {
    return { ...field, category: "draft_from_claims", sourceField: null, reason: "May be drafted only from approved role-specific claims, then reviewed" };
  }
  return { ...field, category: "needs_user_answer", sourceField: null, reason: "No verified reusable value or safe claim-draft rule applies" };
}

export function analyzeFormFields(value: unknown) {
  const fields = parseObservedFormFields(value).map(classifyFormField);
  const summary = {
    total: fields.length,
    safeAutofill: fields.filter((field) => field.category === "safe_autofill").length,
    claimDrafts: fields.filter((field) => field.category === "draft_from_claims").length,
    needsUser: fields.filter((field) => field.category === "needs_user_answer").length,
    sensitiveManual: fields.filter((field) => field.category === "sensitive_manual").length,
    unsupportedManual: fields.filter((field) => field.category === "unsupported_manual").length,
  };
  return { fields, summary };
}

export function draftableApplicationQuestions(fields: ClassifiedFormField[]): ApplicationQuestion[] {
  return fields.filter((field) => field.category === "draft_from_claims").slice(0, 12).map((field) => ({
    id: field.id,
    label: field.label,
    maxLength: field.maxLength !== null && field.maxLength >= 40 ? field.maxLength : null,
  }));
}
