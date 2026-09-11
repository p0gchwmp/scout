const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntitiesOnce(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) return String.fromCodePoint(codePoint);
      return match;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) return String.fromCodePoint(codePoint);
      return match;
    }
    return NAMED_ENTITIES[normalized] ?? match;
  });
}

export function cleanJobText(value: string | null | undefined) {
  let text = String(value ?? "");
  // Some ATS payloads persist encoded markup such as `&lt;p&gt;`. Decode twice so
  // nested `&amp;lt;` sequences become removable markup without ever rendering HTML.
  text = decodeEntitiesOnce(decodeEntitiesOnce(text));
  text = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntitiesOnce(text);
  return text.replace(/\s+/g, " ").trim();
}

export function jobTextPreview(value: string | null | undefined, max = 320) {
  const text = cleanJobText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
