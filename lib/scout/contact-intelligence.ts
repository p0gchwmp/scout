import { officialContactSourceLabel, officialContactSourceScoreBonus } from "./contact-source-registry.ts";

export type ContactIntelligenceSignal = "recruiting" | "general_business" | "low_relevance";

export type PublishedContactLike = {
  email: string;
  excerpt: string;
  sourceType?: string | null;
  sourceContext?: string | null;
  sourceUrl?: string | null;
};

export type RecruiterClue = {
  name?: string;
  role?: string;
};

export type ContactIntelligenceAssessment = {
  signal: ContactIntelligenceSignal;
  score: number;
  reasons: string[];
};

const RECRUITING_PATTERN = /\b(recruit(?:er|ing|ment)?|talent|hiring|careers?|jobs?|people ops|people team|human resources?|\bhr\b|campus|university recruiting|early careers?|internships?|career fair)\b/i;
const GENERAL_BUSINESS_PATTERN = /\b(info|hello|contact|team|office|general|enquir(?:y|ies)|inquir(?:y|ies))\b/i;
const LOW_RELEVANCE_PATTERN = /\b(privacy|legal|security|abuse|press|media|pr@|sales|billing|support|investor|procurement|vendor)\b/i;

function tokens(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((item) => item.length >= 3)
    .slice(0, 12);
}

export function validateLinkedInRecruiterClueUrl(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); }
  catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || url.username || url.password || host !== "linkedin.com") return null;
  if (!/^\/(?:in|pub)\/[A-Za-z0-9%._~-]+\/?$/i.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function assessPublishedContact(contact: PublishedContactLike, clue?: RecruiterClue): ContactIntelligenceAssessment {
  const email = contact.email.trim().toLowerCase();
  const localPart = email.split("@")[0] ?? "";
  const text = `${localPart}\n${contact.excerpt ?? ""}\n${contact.sourceType ?? ""}\n${contact.sourceContext ?? ""}\n${contact.sourceUrl ?? ""}`;
  const reasons: string[] = [];
  let score = 20;

  if (contact.sourceContext && contact.sourceContext !== "first_party") {
    score += 5;
    reasons.push(`Published public recruiting evidence (${contact.sourceContext.replaceAll("_", " ")})`);
  } else {
    score += officialContactSourceScoreBonus(contact.sourceType);
    reasons.push(`Published on ${officialContactSourceLabel(contact.sourceType)}`);
  }

  if (RECRUITING_PATTERN.test(text)) {
    score += 50;
    reasons.push("Recruiting/talent language appears in the address or provenance excerpt");
  } else if (GENERAL_BUSINESS_PATTERN.test(text)) {
    score += 15;
    reasons.push("General business-contact language appears in the address or provenance excerpt");
  }

  if (LOW_RELEVANCE_PATTERN.test(text)) {
    score -= 35;
    reasons.push("The address/excerpt looks unrelated to recruiting");
  }

  const clueText = `${contact.excerpt ?? ""} ${localPart}`.toLowerCase();
  const clueTokens = [...tokens(clue?.name), ...tokens(clue?.role)];
  const matchedTokens = [...new Set(clueTokens.filter((token) => clueText.includes(token)))];
  if (matchedTokens.length) {
    score += Math.min(20, matchedTokens.length * 6);
    reasons.push("The published evidence overlaps with the manual recruiter clue");
  }

  score = Math.max(0, Math.min(100, score));
  const signal: ContactIntelligenceSignal = score >= 70
    ? "recruiting"
    : score >= 35
      ? "general_business"
      : "low_relevance";
  return { signal, score, reasons };
}

export function rankPublishedContacts<T extends PublishedContactLike>(contacts: readonly T[], clue?: RecruiterClue) {
  return [...contacts].sort((left, right) => {
    const rightScore = assessPublishedContact(right, clue).score;
    const leftScore = assessPublishedContact(left, clue).score;
    return rightScore - leftScore || left.email.localeCompare(right.email);
  });
}
