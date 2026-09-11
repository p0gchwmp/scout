const GENERIC_LANDING_TITLE_PATTERNS = [
  /^page[_ -]?title$/i,
  /^search(?:\s+for)?\s+(?:open\s+)?(?:jobs|positions)\b/i,
  /^explore(?:\s+career\s+opportunities|\s+our\s+open\s+positions)\b/i,
  /^open\s+(?:roles|positions)\b/i,
  /^jobs?\s+at\b/i,
  /^careers?(?:\s|$|[-|:])/i,
  /^.+\s+careers?(?:\s|$|[-|:])/i,
  /^join\s+our\s+(?:global\s+)?team\b/i,
  /^opportunities\s+at\b/i,
  /^drivetrain\s*-\s*lever$/i,
] as const;

export function isLikelySpecificJobTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return !GENERIC_LANDING_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}
