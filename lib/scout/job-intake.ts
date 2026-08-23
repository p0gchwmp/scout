import { classifyApplicationUrl } from "./application-sites.ts";

export const JOB_INTAKE_CAPABILITIES = Object.freeze({
  storeLead: true,
  networkFetch: false,
  submit: false,
  send: false,
} as const);

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/i,
];

export type InternshipLeadInput = {
  url: string;
  company: string;
  title: string;
};

export function normalizeInternshipLead(input: InternshipLeadInput) {
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw new Error("A valid internship URL is required");
  }
  if (parsed.protocol !== "https:") throw new Error("Internship URL must use HTTPS");
  if (parsed.username || parsed.password) throw new Error("Internship URL must not contain credentials");
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
    throw new Error("Local or private internship URLs are not accepted");
  }
  parsed.hash = "";

  const channel = classifyApplicationUrl(parsed.toString());
  if (channel.id === "unknown") throw new Error("Unsupported internship URL");

  return {
    canonicalUrl: parsed.toString(),
    company: input.company.trim(),
    title: input.title.trim(),
    channel,
    snapshotRequired: true,
    nextStep: channel.kind === "ats"
      ? "Resolve this official ATS posting into an immutable job snapshot"
      : "Resolve this lead to an official company or ATS posting before application preparation",
  };
}
