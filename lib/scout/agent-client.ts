import {
  validateAiContactClassifications,
  validateAiOutreachResult,
  type AiOutreachEnvelope,
  type PublishedContactCandidate,
} from "./ai-agent.ts";
import { signAgentServiceRequest, type AgentServiceOperation } from "./agent-service-auth.ts";
import type { AtsProvider } from "./types.ts";

const HEX_64 = /^[a-f0-9]{64}$/i;
const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 20_000;

export const AGENT_CLIENT_CAPABILITIES = Object.freeze({
  planJob: true,
  discoverInternships: true,
  resolveJob: true,
  researchContacts: true,
  classifyContacts: true,
  draftOutreach: true,
  createGmailDraft: false,
  sendEmail: false,
  submitApplication: false,
  arbitraryUnsignedRequest: false,
} as const);

export type AgentClientOptions = {
  baseUrl: string;
  sharedSecret: string;
  allowLoopbackDev?: boolean;
  fetcher?: typeof fetch;
  now?: () => Date;
  idFactory?: () => string;
};

export type AgentDiscoveryLead = {
  provider: AtsProvider | "search_index";
  canonicalUrl: string;
  company: string;
  title: string;
  sourceUrl: string;
  focus: string;
  location: string;
  postedAt: string | null;
  platformId: string;
  nextStep: string;
};

export type AgentDiscoveryResponse = {
  taskId: string;
  idempotencyKey: string;
  schemaVersion: 1;
  observedAt: string;
  found: number;
  failures: Array<{ company: string; provider: string; reason: string }>;
  leads: AgentDiscoveryLead[];
};

export type AgentResolvedJobResponse = {
  taskId: string;
  idempotencyKey: string;
  schemaVersion: 1;
  resolvedAt: string;
  source: {
    id: string;
    provider: AtsProvider;
    companyName: string;
    boardToken: string;
    companyDomain: string;
    careersUrl: string;
    enabled: true;
  };
  snapshot: {
    sourceProvider: AtsProvider;
    externalId: string;
    canonicalUrl: string;
    company: string;
    title: string;
    description: string;
    location: string;
    workplaceType: "remote" | "hybrid" | "on-site" | "unspecified";
    score: number;
    scoreExplanation: string[];
    eligibilityRisks: string[];
    postedAt: string | null;
  };
  contentHash: string;
};

export type AgentContactResearchResponse = {
  taskId: string;
  idempotencyKey: string;
  schemaVersion: 1;
  jobSnapshotId: string;
  companyDomain: string;
  researchedAt: string;
  pagesAttempted: number;
  candidates: Array<{
    id: string;
    email: string;
    sourceUrl: string;
    excerpt: string;
    sourceType: "official_careers" | "official_contact" | "official_company";
  }>;
  failures: Array<{ sourceUrl: string; reason: string }>;
};

function isAtsProvider(value: unknown): value is AtsProvider {
  return value === "greenhouse" || value === "lever" || value === "ashby" || value === "workable" || value === "smartrecruiters" || value === "workday" || value === "bamboohr" || value === "recruitee";
}

function loopback(hostname: string) {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "[::1]";
}

function normalizeBaseUrl(value: string, allowLoopbackDev: boolean) {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("SCOUT_AGENT_BASE_URL is invalid"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("SCOUT_AGENT_BASE_URL must be an origin only");
  if (url.pathname !== "/") throw new Error("SCOUT_AGENT_BASE_URL must not contain a path");
  if (url.protocol !== "https:" && !(allowLoopbackDev && url.protocol === "http:" && loopback(url.hostname))) {
    throw new Error("SCOUT_AGENT_BASE_URL must use HTTPS outside explicit loopback development");
  }
  if (!allowLoopbackDev && loopback(url.hostname)) throw new Error("Hosted Scout cannot use a loopback agent URL");
  return url.origin;
}

function stringField(value: unknown, field: string, max = 4000) {
  if (typeof value !== "string") throw new Error(`Agent response ${field} is invalid`);
  const candidate = value.trim();
  if (!candidate || candidate.length > max || candidate.includes("\0")) throw new Error(`Agent response ${field} is invalid`);
  return candidate;
}

function nonNegativeInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`Agent response ${field} is invalid`);
  return value as number;
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Agent response must be an object");
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, field: string, maxItems = 30) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Agent response ${field} is invalid`);
  return value.map((item) => stringField(item, field, 2000));
}

function validateDiscovery(value: unknown): AgentDiscoveryResponse {
  const raw = record(value);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.leads) || raw.leads.length > 100 || !Array.isArray(raw.failures) || raw.failures.length > 100) {
    throw new Error("Agent discovery response is invalid");
  }
  const leads = raw.leads.map((item) => {
    const lead = record(item);
    if (!isAtsProvider(lead.provider) && lead.provider !== "search_index") throw new Error("Agent discovery provider is invalid");
    const canonicalUrl = stringField(lead.canonicalUrl, "canonicalUrl", 2000);
    const sourceUrl = stringField(lead.sourceUrl, "sourceUrl", 2000);
    for (const url of [canonicalUrl, sourceUrl]) if (new URL(url).protocol !== "https:") throw new Error("Agent discovery URL must use HTTPS");
    const postedAt = lead.postedAt === null ? null : stringField(lead.postedAt, "postedAt", 100);
    return {
      provider: lead.provider,
      canonicalUrl,
      company: stringField(lead.company, "company", 200),
      title: stringField(lead.title, "title", 300),
      sourceUrl,
      focus: stringField(lead.focus, "focus", 500),
      location: typeof lead.location === "string" ? lead.location.trim().slice(0, 500) : "",
      postedAt,
      platformId: stringField(lead.platformId, "platformId", 80),
      nextStep: stringField(lead.nextStep, "nextStep", 1000),
    } as AgentDiscoveryLead;
  });
  const failures = raw.failures.map((item) => {
    const failure = record(item);
    return {
      company: stringField(failure.company, "failure company", 200),
      provider: stringField(failure.provider, "failure provider", 80),
      reason: stringField(failure.reason, "failure reason", 500),
    };
  });
  return {
    taskId: stringField(raw.taskId, "taskId", 200),
    idempotencyKey: stringField(raw.idempotencyKey, "idempotencyKey", 200),
    schemaVersion: 1,
    observedAt: stringField(raw.observedAt, "observedAt", 100),
    found: nonNegativeInteger(raw.found, "found"),
    leads,
    failures,
  };
}

function validateResolvedJob(value: unknown): AgentResolvedJobResponse {
  const raw = record(value);
  if (raw.schemaVersion !== 1 || !HEX_64.test(String(raw.contentHash ?? ""))) throw new Error("Agent resolved job response is invalid");
  const source = record(raw.source);
  const snapshot = record(raw.snapshot);
  if (!isAtsProvider(source.provider)) throw new Error("Agent resolved source provider is invalid");
  if (snapshot.sourceProvider !== source.provider) throw new Error("Agent resolved source/snapshot provider mismatch");
  if (source.enabled !== true) throw new Error("Agent resolved source must be enabled");
  const canonicalUrl = stringField(snapshot.canonicalUrl, "resolved canonicalUrl", 2000);
  const careersUrl = stringField(source.careersUrl, "resolved careersUrl", 2000);
  if (new URL(canonicalUrl).protocol !== "https:" || new URL(careersUrl).protocol !== "https:") throw new Error("Agent resolved URLs must use HTTPS");
  const workplaceType = snapshot.workplaceType;
  if (workplaceType !== "remote" && workplaceType !== "hybrid" && workplaceType !== "on-site" && workplaceType !== "unspecified") {
    throw new Error("Agent resolved workplace type is invalid");
  }
  const score = nonNegativeInteger(snapshot.score, "resolved score");
  const postedAt = snapshot.postedAt === null || snapshot.postedAt === undefined ? null : stringField(snapshot.postedAt, "resolved postedAt", 100);
  return {
    taskId: stringField(raw.taskId, "taskId", 200),
    idempotencyKey: stringField(raw.idempotencyKey, "idempotencyKey", 200),
    schemaVersion: 1,
    resolvedAt: stringField(raw.resolvedAt, "resolvedAt", 100),
    source: {
      id: stringField(source.id, "source id", 200),
      provider: source.provider,
      companyName: stringField(source.companyName, "source companyName", 200),
      boardToken: stringField(source.boardToken, "source boardToken", 600),
      companyDomain: stringField(source.companyDomain, "source companyDomain", 300),
      careersUrl,
      enabled: true,
    },
    snapshot: {
      sourceProvider: source.provider,
      externalId: stringField(snapshot.externalId, "snapshot externalId", 1200),
      canonicalUrl,
      company: stringField(snapshot.company, "snapshot company", 200),
      title: stringField(snapshot.title, "snapshot title", 300),
      description: typeof snapshot.description === "string" ? snapshot.description.slice(0, 500_000) : "",
      location: typeof snapshot.location === "string" ? snapshot.location.trim().slice(0, 500) : "",
      workplaceType,
      score,
      scoreExplanation: stringArray(snapshot.scoreExplanation, "scoreExplanation"),
      eligibilityRisks: stringArray(snapshot.eligibilityRisks, "eligibilityRisks"),
      postedAt,
    },
    contentHash: String(raw.contentHash).toLowerCase(),
  };
}

function validateContactResearch(value: unknown): AgentContactResearchResponse {
  const raw = record(value);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.candidates) || raw.candidates.length > 50 || !Array.isArray(raw.failures) || raw.failures.length > 20) {
    throw new Error("Agent contact research response is invalid");
  }
  const candidates = raw.candidates.map((item) => {
    const candidate = record(item);
    if (candidate.sourceType !== "official_careers" && candidate.sourceType !== "official_contact" && candidate.sourceType !== "official_company") {
      throw new Error("Agent contact source type is invalid");
    }
    const email = stringField(candidate.email, "contact email", 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Agent contact email is invalid");
    const sourceUrl = stringField(candidate.sourceUrl, "contact sourceUrl", 2000);
    if (new URL(sourceUrl).protocol !== "https:") throw new Error("Agent contact source URL must use HTTPS");
    return {
      id: stringField(candidate.id, "contact id", 200),
      email,
      sourceUrl,
      excerpt: stringField(candidate.excerpt, "contact excerpt", 2500),
      sourceType: candidate.sourceType,
    };
  });
  const failures = raw.failures.map((item) => {
    const failure = record(item);
    return {
      sourceUrl: stringField(failure.sourceUrl, "failure sourceUrl", 2000),
      reason: stringField(failure.reason, "failure reason", 500),
    };
  });
  return {
    taskId: stringField(raw.taskId, "taskId", 200),
    idempotencyKey: stringField(raw.idempotencyKey, "idempotencyKey", 200),
    schemaVersion: 1,
    jobSnapshotId: stringField(raw.jobSnapshotId, "jobSnapshotId", 200),
    companyDomain: stringField(raw.companyDomain, "companyDomain", 300),
    researchedAt: stringField(raw.researchedAt, "researchedAt", 100),
    pagesAttempted: nonNegativeInteger(raw.pagesAttempted, "pagesAttempted"),
    candidates,
    failures,
  };
}

export function createScoutAgentClient(options: AgentClientOptions) {
  const allowLoopbackDev = options.allowLoopbackDev === true;
  const baseUrl = normalizeBaseUrl(options.baseUrl, allowLoopbackDev);
  const secret = options.sharedSecret.trim();
  if (!HEX_64.test(secret)) throw new Error("SCOUT_AGENT_SHARED_SECRET must be exactly 64 hex characters");
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());

  async function post(operation: AgentServiceOperation, pathname: string, payload: unknown) {
    const body = JSON.stringify(payload);
    const issued = now();
    const expires = new Date(issued.getTime() + 5 * 60_000);
    const taskId = idFactory();
    const idempotencyKey = idFactory();
    const headers = await signAgentServiceRequest({
      method: "POST",
      pathname,
      taskId,
      idempotencyKey,
      issuedAt: issued.toISOString(),
      expiresAt: expires.toISOString(),
      operation,
      body,
      secret,
    });
    const response = await fetcher(`${baseUrl}${pathname}`, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Scout agent request failed (${response.status})`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) throw new Error("Scout agent returned a non-JSON response");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("Scout agent response exceeded the size limit");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("Scout agent response exceeded the size limit");
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error("Scout agent returned invalid JSON"); }
  }

  return Object.freeze({
    async planJob(input: {
      url: string;
      hasOfficialSnapshot: boolean;
      applicationPrepared: boolean;
      hasAcceptedContact: boolean;
      outreachDraftReady: boolean;
      gmailDraftCreated: boolean;
    }) {
      return post("plan_job", "/v1/plan", input);
    },
    async discoverInternships() {
      return validateDiscovery(await post("discover_internships", "/v1/discover", {}));
    },
    async resolveJob(input: { canonicalUrl: string; company?: string; title?: string }) {
      return validateResolvedJob(await post("resolve_job", "/v1/resolve", input));
    },
    async researchContacts(input: { companyDomain: string; jobSnapshotId: string; careersUrl?: string | null }) {
      return validateContactResearch(await post("research_contacts", "/v1/research-contacts", input));
    },
    async classifyContacts(candidates: PublishedContactCandidate[]) {
      const raw = record(await post("classify_contacts", "/v1/classify-contacts", { candidates }));
      if (raw.schemaVersion !== 1 || !Array.isArray(raw.classifications)) throw new Error("Agent contact classification response is invalid");
      return {
        model: stringField(raw.model, "AI model", 200),
        classifications: validateAiContactClassifications(raw.classifications, candidates.map((candidate) => candidate.id)),
      };
    },
    async draftOutreach(envelope: AiOutreachEnvelope) {
      const raw = record(await post("draft_outreach", "/v1/draft-outreach", envelope));
      if (raw.schemaVersion !== 1) throw new Error("Agent outreach response is invalid");
      if (stringField(raw.jobSnapshotId, "AI jobSnapshotId", 200) !== envelope.jobSnapshotId) throw new Error("Agent outreach job snapshot mismatch");
      if (stringField(raw.contactId, "AI contactId", 200) !== envelope.contact.id) throw new Error("Agent outreach contact mismatch");
      const draft = validateAiOutreachResult({ subject: raw.subject, body: raw.body, usedClaimIds: raw.usedClaimIds }, envelope);
      return { model: stringField(raw.model, "AI model", 200), ...draft };
    },
  });
}