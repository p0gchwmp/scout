/* global chrome */
const sensitive = /captcha|password|passcode|mfa|otp|signature|gender|pronoun|race|ethnicity|disability|veteran|date of birth|\bdob\b|age|authorization|authorisation|eligible to work|visa|sponsorship|salary|compensation|notice period|availability|start date|consent|privacy|background check/i;
const captchaSelector = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey], [class*="captcha" i], [id*="captcha" i]';

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

function safeFields() {
  return [...document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select')]
    .filter((input) => !input.disabled && !input.readOnly);
}

function setControlValue(input, value) {
  if (input instanceof HTMLInputElement && (input.type === "checkbox" || input.type === "radio")) return false;
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

async function inspect() {
  const { approvedTask } = await chrome.storage.local.get("approvedTask");
  const taskReady = validApprovedTask(approvedTask);
  const platform = standardPlatform() || (hasEmbeddedTally() ? "tally_custom_domain" : taskReady ? "approved_custom_form" : null);
  return {
    supported: Boolean(platform),
    platform,
    taskReady,
    fields: safeFields().length,
  };
}

async function fill() {
  const { approvedTask } = await chrome.storage.local.get("approvedTask");
  if (!validApprovedTask(approvedTask)) return { blockers: ["No valid Scout-approved task for this exact application page"] };
  if (document.querySelector(captchaSelector)) return { blockers: ["CAPTCHA detected — complete it manually before continuing"] };

  const fields = safeFields();
  const blockers = fields.map(fieldLabel).filter((label) => sensitive.test(label));
  if (blockers.length) return { blockers: [...new Set(blockers.map((label) => `Needs confirmation: ${label}`))] };

  let filled = 0;
  for (const input of fields) {
    const label = fieldLabel(input).toLowerCase();
    const name = `${input.name || ""}`.toLowerCase();
    const answer = approvedTask.answers.find((item) => item?.verified === true && typeof item.key === "string" && typeof item.value === "string" && (label.includes(item.key.toLowerCase()) || name.includes(item.key.toLowerCase())));
    if (!answer?.value) continue;
    input.focus();
    if (setControlValue(input, answer.value)) filled += 1;
  }
  return { filled, blockers: [], submitAvailable: false };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "SCOUT_INSPECT") { inspect().then(respond); return true; }
  if (message.type === "SCOUT_FILL") { fill().then(respond); return true; }
});
