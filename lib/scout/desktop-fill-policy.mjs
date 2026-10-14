// Local-only field mapping. Never use employer text to invent candidate values.
export const DESKTOP_FILL_CAPABILITIES = Object.freeze({
  verifiedProfileOnly: true,
  modifySensitiveFields: false,
  uploadFiles: false,
  approveClaims: false,
  submitApplications: false,
});

const LABEL_ALIASES = Object.freeze({
  full_name: ["full name", "applicant name", "candidate name", "name"],
  email: ["email", "email address", "e mail", "e mail address"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number"],
  university: ["university", "college", "institution", "school"],
  program: ["program", "programme", "course", "degree program", "degree programme", "field of study"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile", "linkedin profile url"],
  github_url: ["github", "github url", "github profile", "github profile url"],
  portfolio_url: ["portfolio", "portfolio url", "personal website", "personal website url"],
  current_location: ["current location", "current city", "city of residence"],
});
const AUTOCOMPLETE = Object.freeze({ name: "full_name", email: "email", tel: "phone", "tel-national": "phone" });
const ATTRIBUTE_ALIASES = Object.freeze({
  full_name: ["full_name", "fullname", "applicant_name", "candidate_name", "applicant_full_name"],
  email: ["email", "email_address", "applicant_email", "candidate_email"],
  phone: ["phone", "phone_number", "mobile", "mobile_number", "applicant_phone", "candidate_phone"],
  university: ["university", "college", "school"],
  linkedin_url: ["linkedin", "linkedin_url"],
  github_url: ["github", "github_url"],
  portfolio_url: ["portfolio", "portfolio_url"],
});
const BLOCKED_CONTEXT = /captcha|password|passcode|mfa|otp|signature|gender|pronoun|race|ethnicity|disability|veteran|date of birth|\bdob\b|\bage\b|authoriz|authoris|eligible to work|visa|sponsor|salary|compensation|notice period|availab|start date|consent|privacy|background check|criminal|citizen|nation|marital|religion|sexual|first name|last name|middle name|surname|given name|family name|reference|referral|recruiter|emergency|guardian|parent|manager|supervisor|cover letter|resume|cv|upload|attachment|file/i;
const SAFE_TYPES = new Set(["text", "email", "tel", "url", "search"]);

export function normalizeDesktopLabel(text) {
  return String(text ?? "")
    .toLowerCase().replace(/\(required\)/g, " ").replace(/[?:*]+$/g, " ")
    .replace(/^please\s+(?:enter|provide|add)\s+(?:your\s+)?/g, "")
    .replace(/^what\s+is\s+(?:your\s+)?/g, "")
    .replace(/^your\s+/g, "")
    .replace(/\brequired\s*$/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function attributeValue(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^.*\[/, "").replace(/\]$/, "");
}

export function safeSourceForDesktopField(field) {
  if (!field || field.visible !== true || field.disabled || field.readOnly) return null;
  if (field.controlKind !== "input" || !SAFE_TYPES.has(field.inputType)) return null;
  const context = [field.label, field.name, field.domId, field.autocomplete, field.placeholder].join(" ");
  if (BLOCKED_CONTEXT.test(context)) return null;
  const label = normalizeDesktopLabel(field.label);
  for (const [source, labels] of Object.entries(LABEL_ALIASES)) {
    if (labels.includes(label)) return source;
  }
  const named = attributeValue(field.name);
  const domId = attributeValue(field.domId);
  const hasMeaningfulLabel = label && label !== "field" && label !== "input" && label !== normalizeDesktopLabel(named) && label !== normalizeDesktopLabel(domId);
  if (hasMeaningfulLabel) return null;
  const auto = String(field.autocomplete ?? "").trim().toLowerCase().split(/\s+/).at(-1);
  if (auto && Object.hasOwn(AUTOCOMPLETE, auto)) return AUTOCOMPLETE[auto];
  for (const [source, names] of Object.entries(ATTRIBUTE_ALIASES)) {
    if (names.includes(named) || names.includes(domId)) return source;
  }
  return null;
}

export function planVerifiedDesktopFill(fields, answers) {
  if (!Array.isArray(fields) || fields.length > 40 || !Array.isArray(answers)) throw new Error("Bounded Scout desktop fill input required");
  const verified = new Map();
  for (const answer of answers) {
    if (answer?.verified !== true || typeof answer.sourceField !== "string" || typeof answer.value !== "string" || !answer.value.trim()) continue;
    if (verified.has(answer.sourceField) && verified.get(answer.sourceField) !== answer.value) throw new Error("Conflicting verified field values");
    verified.set(answer.sourceField, answer.value);
  }
  const approved = [];
  for (const field of fields) {
    const sourceField = safeSourceForDesktopField(field);
    if (!sourceField || !verified.has(sourceField)) continue;
    if (!Number.isSafeInteger(field.index) || field.index < 0 || field.index >= 40) continue;
    approved.push({ index: field.index, sourceField, value: verified.get(sourceField), fingerprint: field.fingerprint });
  }
  return approved;
}
