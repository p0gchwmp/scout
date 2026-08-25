/* global chrome */
const sensitive = /captcha|password|passcode|mfa|otp|signature|gender|pronoun|race|ethnicity|disability|veteran|date of birth|\bdob\b|age|authorization|authorisation|eligible to work|visa|sponsorship|salary|compensation|notice period|availability|start date|consent|privacy|background check|criminal|citizenship|nationality|marital|religion|sexual orientation/i;
const captchaSelector = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey], [class*="captcha" i], [id*="captcha" i]';

const profileAliases = {
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
};

const portalRules = [
  ["greenhouse", (host) => host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io"],
  ["lever", (host) => host === "jobs.lever.co"],
  ["ashby", (host) => host === "jobs.ashbyhq.com"],
  ["workday", (host) => host.endsWith(".myworkdayjobs.com") || host.endsWith(".myworkdaysite.com")],
  ["bamboohr", (host) => host.endsWith(".bamboohr.com")],
  ["linkedin_easy_apply", (host) => host === "www.linkedin.com" && location.pathname.startsWith("/jobs")],
  ["internshala", (host) => host === "internshala.com" || host.endsWith(".internshala.com")],
  ["tally", (host) => host === "tally.so" || host.endsWith(".tally.so")],
  ["google_forms", (host) => host === "docs.google.com" || host === "forms.gle"],
  ["typeform", (host) => host.endsWith(".typeform.com")],
  ["fillout", (host) => host.endsWith(".fillout.com")],
  ["jotform", (host) => host.endsWith(".jotform.com")],
  ["microsoft_forms", (host) => host === "forms.office.com"],
  ["indeed", (host) => host.endsWith(".indeed.com") || host.endsWith(".indeed.co.in")],
  ["naukri", (host) => host === "naukri.com" || host.endsWith(".naukri.com")],
  ["wellfound", (host) => host === "wellfound.com" || host.endsWith(".wellfound.com")],
  ["unstop", (host) => host === "unstop.com" || host.endsWith(".unstop.com")],
  ["cutshort", (host) => host === "cutshort.io" || host.endsWith(".cutshort.io")],
  ["foundit", (host) => host === "foundit.in" || host.endsWith(".foundit.in")],
];

function fieldLabel(input) {
  const explicit = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : "";
  return `${explicit || input.closest("label")?.textContent || input.getAttribute("aria-label") || input.getAttribute("placeholder") || input.name || input.id || "field"}`.replace(/\s+/g, " ").trim();
}

function normalizeLabel(value) {
  return `${value || ""}`
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

function profileFieldForLabel(label) {
  const normalized = normalizeLabel(label);
  return Object.entries(profileAliases).find(([, aliases]) => aliases.includes(normalized))?.[0] || null;
}

function standardPlatform() {
  const host = location.hostname.toLowerCase();
  const rule = portalRules.find(([, matches]) => matches(host));
  if (!rule) return null;
  if (rule[0] === "linkedin_easy_apply") {
    const modal = document.querySelector('.jobs-easy-apply-modal, [role="dialog"] form, .artdeco-modal form');
    return modal ? rule[0] : null;
  }
  return rule[0];
}

function hasEmbeddedTally() {
  return Boolean(document.querySelector('iframe[src*="tally.so"], script[src*="tally.so"], [data-tally-open], [data-tally-overlay]'));
}

function validApprovedTask(task) {
  if (!task || typeof task !== "object" || !Array.isArray(task.answers)) return false;
  if (!Number.isFinite(task.expiresAt) || task.expiresAt < Date.now()) return false;
  if (task.allowedDomain !== location.hostname) return false;
  if (task.allowedUrl) {
    try {
      const expected = new URL(task.allowedUrl);
      if (expected.origin !== location.origin || expected.pathname !== location.pathname) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function visibleFields() {
  return [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')]
    .filter((input) => !input.disabled && !input.readOnly)
    .slice(0, 40);
}

function describeField(input, index) {
  const label = fieldLabel(input);
  const controlKind = input instanceof HTMLTextAreaElement ? "textarea" : input instanceof HTMLSelectElement ? "select" : "input";
  const inputType = input instanceof HTMLInputElement ? (input.type || "text").toLowerCase() : controlKind;
  const rawMax = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement ? input.maxLength : -1;
  const maxLength = Number.isInteger(rawMax) && rawMax >= 1 && rawMax <= 5000 ? rawMax : null;
  return {
    id: `field-${index}`,
    label,
    controlKind,
    inputType,
    maxLength,
    required: input.required === true,
  };
}

function classifyField(field) {
  const sourceField = profileFieldForLabel(field.label);
  if (field.inputType === "password" || sensitive.test(field.label)) return { ...field, category: "sensitive_manual", sourceField: null };
  if (field.inputType === "file") return { ...field, category: "unsupported_manual", sourceField: null };
  if (field.inputType === "checkbox" || field.inputType === "radio") return { ...field, category: "needs_user_answer", sourceField: null };
  if (sourceField) return { ...field, category: "safe_autofill", sourceField };
  const freeText = field.controlKind === "textarea"
    || (field.controlKind === "input" && ["text", "search"].includes(field.inputType) && (field.maxLength === null || field.maxLength >= 40));
  if (freeText) return { ...field, category: "draft_from_claims", sourceField: null };
  return { ...field, category: "needs_user_answer", sourceField: null };
}

function inspectFormFields() {
  const fields = visibleFields().map(describeField).map(classifyField);
  return {
    summary: {
      total: fields.length,
      safeAutofill: fields.filter((field) => field.category === "safe_autofill").length,
      claimDrafts: fields.filter((field) => field.category === "draft_from_claims").length,
      needsUser: fields.filter((field) => field.category === "needs_user_answer").length,
      sensitiveManual: fields.filter((field) => field.category === "sensitive_manual").length,
      unsupportedManual: fields.filter((field) => field.category === "unsupported_manual").length,
    },
    fields,
  };
}

function setControlValue(input, value) {
  if (input instanceof HTMLInputElement && (input.type === "checkbox" || input.type === "radio" || input.type === "file")) return false;
  if (input instanceof HTMLSelectElement) {
    const option = [...input.options].find((item) => item.value === value || item.text.trim().toLowerCase() === value.trim().toLowerCase());
    if (!option) return false;
    input.value = option.value;
  } else {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, value);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function answerForField(task, field, input) {
  const normalizedLabel = normalizeLabel(field.label);
  const normalizedName = normalizeLabel(`${input.name || ""}`.replace(/[\[\]_-]+/g, " "));
  return task.answers.find((item) => {
    if (!item || typeof item.key !== "string" || typeof item.value !== "string") return false;
    if (item.verified !== true && !(item.aiDraft === true && item.reviewed === true)) return false;
    const key = normalizeLabel(item.key);
    return key === normalizedLabel || (normalizedName && key === normalizedName);
  });
}

async function inspect() {
  const { approvedTask } = await chrome.storage.local.get("approvedTask");
  const taskReady = validApprovedTask(approvedTask);
  const platform = standardPlatform() || (hasEmbeddedTally() ? "tally_custom_domain" : taskReady ? "approved_custom_form" : null);
  const formIntelligence = inspectFormFields();
  return {
    supported: Boolean(platform),
    platform,
    taskReady,
    fields: formIntelligence.summary.total,
    formIntelligence,
    questions: formIntelligence.fields
      .filter((field) => field.category === "draft_from_claims" || field.category === "sensitive_manual")
      .slice(0, 8)
      .map(({ id, label, maxLength }) => ({ id, label, maxLength: maxLength !== null && maxLength >= 40 ? maxLength : null })),
  };
}

async function fill() {
  const { approvedTask } = await chrome.storage.local.get("approvedTask");
  if (!validApprovedTask(approvedTask)) return { blockers: ["No valid Scout-approved task for this exact application page"] };
  if (document.querySelector(captchaSelector)) return { blockers: ["CAPTCHA detected — complete it manually before continuing"] };

  const inputs = visibleFields();
  const described = inputs.map(describeField).map(classifyField);
  const blockers = [];
  let filled = 0;
  let reviewedDraftsFilled = 0;

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const field = described[index];
    if (field.category === "sensitive_manual") {
      blockers.push(`Needs confirmation: ${field.label}`);
      continue;
    }
    if (field.category === "unsupported_manual") {
      if (field.required) blockers.push(`Manual file step: ${field.label}`);
      continue;
    }
    if (field.category === "needs_user_answer") {
      if (field.required) blockers.push(`Needs your answer: ${field.label}`);
      continue;
    }

    const answer = answerForField(approvedTask, field, input);
    if (!answer?.value) {
      if (field.required) blockers.push(field.category === "safe_autofill" ? `Missing verified value: ${field.label}` : `Review or answer manually: ${field.label}`);
      continue;
    }
    if (field.category === "safe_autofill" && answer.verified !== true) {
      if (field.required) blockers.push(`Missing verified value: ${field.label}`);
      continue;
    }
    if (field.category === "draft_from_claims" && (answer.aiDraft !== true || answer.reviewed !== true)) {
      if (field.required) blockers.push(`Review or answer manually: ${field.label}`);
      continue;
    }
    input.focus();
    if (setControlValue(input, answer.value)) {
      filled += 1;
      if (answer.aiDraft === true && answer.reviewed === true) reviewedDraftsFilled += 1;
    } else if (field.required) {
      blockers.push(`Could not safely fill: ${field.label}`);
    }
  }
  return {
    filled,
    reviewedDraftsFilled,
    formIntelligence: inspectFormFields().summary,
    blockers: [...new Set(blockers)],
    submitAvailable: false,
    unreviewedAiDraftsFillable: false,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "SCOUT_INSPECT") { inspect().then(respond); return true; }
  if (message.type === "SCOUT_FILL") { fill().then(respond); return true; }
});
