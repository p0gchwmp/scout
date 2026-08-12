/* global chrome */
const sensitive = /captcha|password|mfa|signature|gender|race|ethnicity|disability|veteran|authorization|visa|sponsorship|salary|compensation|consent|privacy/i;
const supportedHosts = new Set(["boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"]);

function fieldLabel(input) {
  const explicit = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : "";
  return `${explicit || input.closest("label")?.textContent || input.getAttribute("aria-label") || input.name || input.id || "field"}`.trim();
}

async function fill() {
  const { approvedTask } = await chrome.storage.local.get("approvedTask");
  if (!approvedTask || approvedTask.expiresAt < Date.now() || approvedTask.allowedDomain !== location.hostname) return { blockers: ["No valid approved task for this portal"] };
  const fields = [...document.querySelectorAll("input:not([type=hidden]), textarea, select")];
  const blockers = fields.map(fieldLabel).filter((label) => sensitive.test(label));
  if (blockers.length) return { blockers: blockers.map((label) => `Needs confirmation: ${label}`) };
  let filled = 0;
  for (const input of fields) {
    const label = fieldLabel(input).toLowerCase();
    const answer = approvedTask.answers.find((item) => item.verified && (label.includes(item.key.toLowerCase()) || input.name?.toLowerCase().includes(item.key.toLowerCase())));
    if (!answer || !answer.value) continue;
    input.focus();
    input.value = answer.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    filled++;
  }
  return { filled, blockers: [] };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "SCOUT_INSPECT") respond({ supported: supportedHosts.has(location.hostname), fields: document.querySelectorAll("input, textarea, select").length });
  if (message.type === "SCOUT_FILL") { fill().then(respond); return true; }
});
