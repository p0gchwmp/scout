import discoveryCatalog from "../../config/discovery-sources.json" with { type: "json" };
import { snapshotHash } from "./sync.ts";

const INTERNSHIP_PATTERN = /\b(intern|internship|trainee|apprentice|co-?op)\b/i;
const INDIA_OR_REMOTE_PATTERN = /\b(india|bengaluru|bangalore|chennai|hyderabad|noida|gurugram|gurgaon|mumbai|delhi|pune|kolkata|remote)\b/i;
const HEX_64 = /^[a-f0-9]{64}$/i;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type LocalBridgeLead = {
  provider: "greenhouse" | "lever";
  slug: string;
  company: string;
  companyDomain: string;
  sourceUrl: string;
  focus: string;
  externalId: string;
  canonicalUrl: string;
  title: string;
  description: string;
  location: string;
  workplaceType: "remote" | "hybrid" | "on-site" | "unspecified";
  postedAt: string | null;
};

export type VerifiedLocalDiscovery = {
  observedAt: string;
  leads: LocalBridgeLead[];
  failures: Array<{ company: string; provider: string; reason: string }>;
};

function bytesFromHex(value: string) {
  if (!HEX_64.test(value)) throw new Error("Invalid discovery bridge signature");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}

async function verifyHmac(payload: string, signature: string, secret: string) {
  if (!HEX_64.test(secret)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, bytesFromHex(signature), new TextEncoder().encode(payload));
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function string(value: unknown, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || hasControlCharacters(trimmed)) throw new Error(`${field} is invalid`);
  return trimmed;
}

function validateLead(value: unknown): LocalBridgeLead {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Discovery lead is invalid");
  const raw = value as Record<string, unknown>;
  const provider = raw.provider;
  if (provider !== "greenhouse" && provider !== "lever") throw new Error("Discovery provider is invalid");
  const slug = string(raw.slug, "Discovery source slug", 80);
  const source = discoveryCatalog.find((candidate) => candidate.provider === provider && candidate.slug === slug);
  if (!source) throw new Error("Discovery source is not controlled");

  const company = string(raw.company, "Company", 160);
  const companyDomain = string(raw.companyDomain, "Company domain", 240).toLowerCase();
  const sourceUrl = string(raw.sourceUrl, "Source URL", 500);
  const focus = string(raw.focus, "Source focus", 300);
  if (company !== source.company || companyDomain !== source.companyDomain || sourceUrl !== source.sourceUrl || focus !== source.focus) {
    throw new Error("Discovery source metadata does not match the controlled catalog");
  }

  const externalId = string(raw.externalId, "External id", 128);
  if (!ID_PATTERN.test(externalId)) throw new Error("External id is invalid");
  const canonicalUrl = string(raw.canonicalUrl, "Canonical URL", 1200);
  let url: URL;
  try { url = new URL(canonicalUrl); } catch { throw new Error("Canonical URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new Error("Canonical URL is not an exact HTTPS posting URL");
  const parts = url.pathname.split("/").filter(Boolean);
  if (provider === "greenhouse") {
    if (!(url.hostname === "job-boards.greenhouse.io" || url.hostname === "boards.greenhouse.io") || parts.length !== 3 || parts[0] !== slug || parts[1] !== "jobs" || parts[2] !== externalId || url.search) {
      throw new Error("Greenhouse canonical URL does not match its controlled source");
    }
  } else if (url.hostname !== "jobs.lever.co" || parts.length < 2 || parts[0] !== slug || parts[1] !== externalId) {
    throw new Error("Lever canonical URL does not match its controlled source");
  }

  const title = string(raw.title, "Title", 300);
  const description = typeof raw.description === "string" ? raw.description.slice(0, 250_000) : "";
  const location = typeof raw.location === "string" ? raw.location.slice(0, 500) : "";
  const workplaceType = raw.workplaceType;
  if (workplaceType !== "remote" && workplaceType !== "hybrid" && workplaceType !== "on-site" && workplaceType !== "unspecified") throw new Error("Workplace type is invalid");
  if (!INTERNSHIP_PATTERN.test(`${title}\n${description}`) || !INDIA_OR_REMOTE_PATTERN.test(`${location}\n${workplaceType}\n${description.slice(0, 1600)}`)) {
    throw new Error("Discovery result does not match the internship/location policy");
  }
  const postedAt = raw.postedAt === null || raw.postedAt === undefined ? null : string(raw.postedAt, "Posted at", 100);

  return { provider, slug, company, companyDomain, sourceUrl, focus, externalId, canonicalUrl: url.href, title, description, location, workplaceType, postedAt };
}

export async function verifyLocalDiscoveryEnvelope(input: unknown, secret: string, now = Date.now()): Promise<VerifiedLocalDiscovery> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A discovery bridge envelope is required");
  const envelope = input as Record<string, unknown>;
  const payload = string(envelope.payload, "Discovery payload", 2_000_000);
  const signature = string(envelope.signature, "Discovery signature", 128);
  if (!(await verifyHmac(payload, signature, secret))) throw new Error("Discovery bridge signature verification failed");

  let decoded: unknown;
  try { decoded = JSON.parse(payload); } catch { throw new Error("Discovery payload is invalid JSON"); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Discovery payload is invalid");
  const raw = decoded as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new Error("Unsupported discovery payload version");
  const observedAt = string(raw.observedAt, "Observed at", 100);
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime) || Math.abs(now - observedTime) > 15 * 60 * 1000) throw new Error("Discovery payload is stale");
  if (!Array.isArray(raw.leads) || raw.leads.length > 100) throw new Error("Discovery lead list is invalid");
  if (!Array.isArray(raw.failures) || raw.failures.length > discoveryCatalog.length) throw new Error("Discovery failure list is invalid");

  const leads = raw.leads.map(validateLead);
  const failures = raw.failures.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Discovery failure is invalid");
    const failure = value as Record<string, unknown>;
    return {
      company: string(failure.company, "Failure company", 160),
      provider: string(failure.provider, "Failure provider", 40),
      reason: string(failure.reason, "Failure reason", 200),
    };
  });
  return { observedAt, leads, failures };
}

export async function localDiscoverySnapshot(lead: LocalBridgeLead) {
  if (lead.provider !== "greenhouse") return null;
  const snapshot = {
    sourceProvider: "greenhouse" as const,
    externalId: lead.externalId,
    canonicalUrl: lead.canonicalUrl,
    company: lead.company,
    title: lead.title,
    description: lead.description,
    location: lead.location,
    workplaceType: lead.workplaceType,
    score: 0,
    scoreExplanation: ["Unranked: application review uses approved candidate claims"],
    eligibilityRisks: [] as string[],
    postedAt: lead.postedAt ?? undefined,
  };
  return { snapshot, contentHash: await snapshotHash(snapshot) };
}
