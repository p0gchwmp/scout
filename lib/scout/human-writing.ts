export const HUMAN_WRITING_STYLE_VERSION = 1;

export const HUMAN_WRITING_CAPABILITIES = Object.freeze({
  rewriteStyle: true,
  preserveClaims: true,
  matchVerifiedVoiceSample: true,
  inventFacts: false,
  addMetrics: false,
  changeEligibility: false,
  evadeDetectionGuarantee: false,
} as const);

export type HumanWritingKind = "outreach" | "application_answer";

export type HumanWritingWarning = {
  id: string;
  message: string;
};

const PATTERNS: Array<{ id: string; message: string; pattern: RegExp }> = [
  { id: "generic-email-opening", message: "Remove the stock email opening and start with the actual reason for writing.", pattern: /\bi hope this (?:email|message) finds you well\b|\bi am writing to (?:express|convey) my (?:interest|enthusiasm)\b/i },
  { id: "inflated-enthusiasm", message: "Replace inflated enthusiasm with a specific, grounded reason for interest.", pattern: /\b(?:thrilled|incredibly excited|extremely excited|deeply passionate|perfectly aligns?|dream opportunity|prestigious|renowned|groundbreaking)\b/i },
  { id: "ai-vocabulary", message: "Use plainer wording instead of common AI-writing vocabulary.", pattern: /\b(?:delve|foster(?:ing)?|pivotal|tapestry|testament|underscor(?:e|es|ing)|showcas(?:e|es|ing)|vibrant|multifaceted|ever-evolving landscape|dynamic landscape)\b/i },
  { id: "corporate-fluff", message: "Cut generic corporate phrasing that does not add evidence.", pattern: /\b(?:leverage my skills|contribute meaningfully|make a meaningful impact|add value to your team|fast-paced environment|dynamic team|synergy|results-driven)\b/i },
  { id: "fake-contrast", message: "State the point directly instead of using a formulaic not-X-but-Y contrast.", pattern: /\b(?:it(?:'|’)s|this is) not (?:just|only|merely)\b[^.?!]{0,100}\b(?:it(?:'|’)s|but)\b/i },
  { id: "chatbot-closing", message: "Remove chatbot-style offers and generic closings.", pattern: /\b(?:i hope this helps|let me know if you(?:'|’)d like|would you like me to|happy to provide anything else)\b/i },
  { id: "filler", message: "Shorten filler phrases.", pattern: /\b(?:in order to|due to the fact that|at this point in time|with regard to|in terms of)\b/i },
  { id: "em-dash", message: "Use ordinary punctuation instead of em/en dashes unless the verified voice sample clearly uses them.", pattern: /[—–]/ },
  { id: "emoji", message: "Remove decorative emoji from professional application writing.", pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u },
];

function compact(value: string, max: number) {
  const cleaned = value.replace(/\r\n/g, "\n").trim();
  if (!cleaned || cleaned.length > max || cleaned.includes("\0")) throw new Error("Human-writing input is invalid");
  return cleaned;
}

export function lintHumanWriting(text: string, kind: HumanWritingKind, voiceSample?: string | null): HumanWritingWarning[] {
  const candidate = compact(text, kind === "outreach" ? 6000 : 8000);
  const warnings: HumanWritingWarning[] = [];
  const sampleUsesDash = Boolean(voiceSample && /[—–]/.test(voiceSample));
  for (const rule of PATTERNS) {
    if (rule.id === "em-dash" && sampleUsesDash) continue;
    if (rule.pattern.test(candidate)) warnings.push({ id: rule.id, message: rule.message });
  }
  if (kind === "outreach") {
    const words = candidate.split(/\s+/).filter(Boolean).length;
    if (words > 190) warnings.push({ id: "too-long", message: "Keep cold outreach under roughly 190 words unless the role genuinely needs more context." });
    if ((candidate.match(/\n\s*[-*•]\s+/g) ?? []).length >= 3) warnings.push({ id: "list-heavy", message: "Cold outreach should read like a short note, not a generated feature list." });
  }
  const sentenceStarts = candidate.match(/(?:^|[.!?]\s+)(I|My)\b/g) ?? [];
  if (sentenceStarts.length >= 5) warnings.push({ id: "repetitive-openings", message: "Vary repeated I/My sentence openings where it sounds mechanical." });
  return warnings;
}

export function humanWritingSystemInstruction(kind: HumanWritingKind, voiceSample?: string | null) {
  const voice = voiceSample?.trim()
    ? `\nA verified writing sample is included in the input. Match its sentence rhythm, word choice, punctuation, and level of formality without copying distinctive factual details from it.`
    : "";
  const purpose = kind === "outreach"
    ? "Write a short recruiting/outreach note that sounds like a real student wrote it after reading this specific role."
    : "Write concise application-form answers that sound like the candidate, not a generic cover-letter generator.";
  return [
    purpose,
    "Preserve the supplied facts and claim meanings exactly. Do not invent a credential, metric, result, date, eligibility fact, referral, tool, employer, project outcome, or motivation that is not supplied.",
    "Prefer plain verbs and concrete nouns. Remove sales language, vague praise, stock AI vocabulary, fake depth, forced groups of three, formulaic not-X-but-Y contrasts, filler, chatbot closings, and generic positive endings.",
    "Do not open with 'I hope this email finds you well' or 'I am writing to express my interest'. Avoid inflated words such as thrilled, prestigious, groundbreaking, pivotal, vibrant, delve, foster, tapestry, testament, showcase, and generic claims about making an impact.",
    "Use natural sentence-length variation. Professional does not mean stiff. Specific beats enthusiastic.",
    "Do not use emoji. Avoid em/en dashes unless the verified writing sample genuinely uses them.",
    voice,
    `Human-writing style version: ${HUMAN_WRITING_STYLE_VERSION}.`,
  ].filter(Boolean).join("\n");
}

function anchors(value: string) {
  return {
    emails: [...new Set(value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])].map((item) => item.toLowerCase()),
    urls: [...new Set(value.match(/https?:\/\/[^\s)\]>"']+/gi) ?? [])],
    numbers: [...new Set(value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [])],
  };
}

export function assertNoNewAnchoredFacts(output: string, allowedSourceText: string) {
  const finalText = compact(output, 12_000);
  const allowed = anchors(allowedSourceText);
  const observed = anchors(finalText);
  const allowedEmails = new Set(allowed.emails);
  const allowedUrls = new Set(allowed.urls);
  const allowedNumbers = new Set(allowed.numbers);
  if (observed.emails.some((item) => !allowedEmails.has(item))) throw new Error("Humanized writing introduced an email address that was not supplied");
  if (observed.urls.some((item) => !allowedUrls.has(item))) throw new Error("Humanized writing introduced a URL that was not supplied");
  if (observed.numbers.some((item) => !allowedNumbers.has(item))) throw new Error("Humanized writing introduced a number or metric that was not supplied");
}

export function sameStringSet(left: string[], right: string[]) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
