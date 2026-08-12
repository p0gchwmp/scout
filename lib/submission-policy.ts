export type FormQuestion = { key: string; label: string; kind: string; value?: string; verified?: boolean };

const sensitive = /captcha|password|mfa|signature|gender|race|ethnicity|disability|veteran|authorization|visa|sponsorship|salary|compensation|consent|privacy/i;

export function evaluateSubmission(domain: string, questions: FormQuestion[], allowlistedDomains: string[]) {
  const blockers: string[] = [];
  if (!allowlistedDomains.includes(domain)) blockers.push("Portal is not allowlisted");
  for (const question of questions) {
    if (sensitive.test(`${question.key} ${question.label} ${question.kind}`)) blockers.push(`Needs confirmation: ${question.label}`);
    else if (!question.value || !question.verified) blockers.push(`Missing verified answer: ${question.label}`);
  }
  return { canAutoSubmit: blockers.length === 0, blockers: [...new Set(blockers)] };
}
