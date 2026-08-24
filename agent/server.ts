import { createServer } from "node:http";
import { buildAiOutreachEnvelope, type PublishedContactCandidate } from "../lib/scout/ai-agent.ts";
import { AGENT_EXECUTION_CAPABILITIES, planAgentTasks } from "../lib/scout/agent-task-planner.ts";
import { AGENT_SERVICE_CAPABILITIES, InMemoryAgentReplayGuard, verifyAgentServiceRequest } from "../lib/scout/agent-service-auth.ts";
import { resolveControlledLead } from "../lib/scout/lead-resolution.ts";
import { createAgentAiProvider } from "./ai-runtime.ts";
import { runAgentDiscovery } from "./discovery.ts";
import { researchPublishedCompanyContacts } from "./contact-research.ts";
import { createOrReuseGmailDraft } from "./gmail-drafts.ts";

const port = Number(process.env.PORT ?? process.env.SCOUT_AGENT_PORT ?? 8788);
const secret = process.env.SCOUT_AGENT_SHARED_SECRET?.trim() ?? "";
const replayGuard = new InMemoryAgentReplayGuard();

if (!/^[a-f0-9]{64}$/i.test(secret)) {
  throw new Error("SCOUT_AGENT_SHARED_SECRET must be exactly 64 hex characters before starting the Scout agent service");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Scout agent port is invalid");

function json(response: import("node:http").ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

function toWebRequest(request: import("node:http").IncomingMessage, body: string) {
  const host = request.headers.host ?? `127.0.0.1:${port}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.set(key, value);
  }
  return new Request(`http://${host}${request.url ?? "/"}`, { method: request.method ?? "GET", headers, body: body || undefined });
}

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function object(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, {
        service: "scout-agent",
        status: "ok",
        capabilities: { ...AGENT_EXECUTION_CAPABILITIES, ...AGENT_SERVICE_CAPABILITIES },
      });
    }

    const allowedPaths = ["/v1/plan", "/v1/discover", "/v1/resolve", "/v1/research-contacts", "/v1/classify-contacts", "/v1/draft-outreach", "/v1/create-gmail-draft"];
    if (request.method !== "POST" || !allowedPaths.includes(request.url ?? "")) return json(response, 404, { error: "Not found" });
    const rawBody = await readBody(request);
    const verified = await verifyAgentServiceRequest(toWebRequest(request, rawBody), secret);
    const expectedOperation = request.url === "/v1/plan"
      ? "plan_job"
      : request.url === "/v1/discover"
        ? "discover_internships"
        : request.url === "/v1/resolve"
          ? "resolve_job"
          : request.url === "/v1/research-contacts"
            ? "research_contacts"
            : request.url === "/v1/classify-contacts"
              ? "classify_contacts"
              : request.url === "/v1/create-gmail-draft"
                ? "create_gmail_draft"
                : "draft_outreach";
    if (verified.auth.operation !== expectedOperation) return json(response, 409, { error: "Signed operation does not match this endpoint" });
    if (!replayGuard.accept(verified.auth)) return json(response, 409, { error: "Duplicate or replayed agent task" });

    let payload: unknown;
    try { payload = JSON.parse(verified.body); }
    catch { return json(response, 400, { error: "Invalid JSON body" }); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json(response, 400, { error: "Request payload must be an object" });

    if (request.url === "/v1/discover") {
      if (Object.keys(payload as Record<string, unknown>).length !== 0) {
        return json(response, 400, { error: "Discovery sources are server-controlled; caller-supplied discovery fields are not accepted" });
      }
      const discovery = await runAgentDiscovery();
      return json(response, 200, { taskId: verified.auth.taskId, idempotencyKey: verified.auth.idempotencyKey, ...discovery });
    }

    if (request.url === "/v1/resolve") {
      const raw = payload as Record<string, unknown>;
      if (typeof raw.canonicalUrl !== "string" || Object.keys(raw).some((key) => key !== "canonicalUrl")) {
        return json(response, 400, { error: "Resolve accepts only canonicalUrl" });
      }
      const resolved = await resolveControlledLead(raw.canonicalUrl);
      return json(response, 200, {
        taskId: verified.auth.taskId,
        idempotencyKey: verified.auth.idempotencyKey,
        schemaVersion: 1,
        resolvedAt: new Date().toISOString(),
        ...resolved,
      });
    }

    if (request.url === "/v1/research-contacts") {
      const raw = payload as Record<string, unknown>;
      if (typeof raw.companyDomain !== "string" || typeof raw.jobSnapshotId !== "string") {
        return json(response, 400, { error: "companyDomain and jobSnapshotId are required" });
      }
      if (Object.keys(raw).some((key) => key !== "companyDomain" && key !== "jobSnapshotId")) {
        return json(response, 400, { error: "Contact research accepts only the registered company domain and pinned job snapshot id" });
      }
      const research = await researchPublishedCompanyContacts({ companyDomain: raw.companyDomain, jobSnapshotId: raw.jobSnapshotId });
      return json(response, 200, { taskId: verified.auth.taskId, idempotencyKey: verified.auth.idempotencyKey, ...research });
    }

    if (request.url === "/v1/classify-contacts") {
      const raw = payload as Record<string, unknown>;
      if (!Array.isArray(raw.candidates) || raw.candidates.length < 1 || raw.candidates.length > 50 || Object.keys(raw).some((key) => key !== "candidates")) {
        return json(response, 400, { error: "Classify contacts accepts only 1-50 published contact candidates" });
      }
      const candidates = raw.candidates.map((candidate, index) => {
        const item = object(candidate, `Candidate ${index + 1}`);
        return {
          id: String(item.id ?? ""),
          email: String(item.email ?? ""),
          sourceUrl: String(item.sourceUrl ?? ""),
          excerpt: String(item.excerpt ?? ""),
          sourceType: String(item.sourceType ?? ""),
        } as PublishedContactCandidate;
      });
      const classifications = await createAgentAiProvider().classifyPublishedContacts(candidates);
      return json(response, 200, {
        taskId: verified.auth.taskId,
        idempotencyKey: verified.auth.idempotencyKey,
        schemaVersion: 1,
        model: process.env.SCOUT_AI_MODEL ?? "",
        classifications,
      });
    }

    if (request.url === "/v1/draft-outreach") {
      const raw = payload as Record<string, unknown>;
      const contact = object(raw.contact, "Contact");
      if (!Array.isArray(raw.claims)) return json(response, 400, { error: "Approved claims are required" });
      const claims = raw.claims.map((claim, index) => {
        const item = object(claim, `Claim ${index + 1}`);
        return { id: String(item.id ?? ""), statement: String(item.statement ?? ""), status: item.status as "approved" };
      });
      const envelope = buildAiOutreachEnvelope({
        jobSnapshotId: String(raw.jobSnapshotId ?? ""),
        companyName: String(raw.companyName ?? ""),
        roleTitle: String(raw.roleTitle ?? ""),
        candidateName: String(raw.candidateName ?? ""),
        contact: {
          id: String(contact.id ?? ""),
          email: String(contact.email ?? ""),
          sourceUrl: String(contact.sourceUrl ?? ""),
          excerpt: String(contact.excerpt ?? ""),
          reviewState: contact.reviewState as "accepted",
        },
        claims,
      });
      const draft = await createAgentAiProvider().draftOutreach(envelope);
      return json(response, 200, {
        taskId: verified.auth.taskId,
        idempotencyKey: verified.auth.idempotencyKey,
        schemaVersion: 1,
        model: process.env.SCOUT_AI_MODEL ?? "",
        jobSnapshotId: envelope.jobSnapshotId,
        contactId: envelope.contact.id,
        ...draft,
      });
    }

    if (request.url === "/v1/create-gmail-draft") {
      const raw = payload as Record<string, unknown>;
      const allowed = new Set(["revisionId", "to", "subject", "body"]);
      if (Object.keys(raw).some((key) => !allowed.has(key))) return json(response, 400, { error: "Gmail draft accepts only the pinned revision fields" });
      if ([raw.revisionId, raw.to, raw.subject, raw.body].some((value) => typeof value !== "string")) {
        return json(response, 400, { error: "revisionId, to, subject and body are required" });
      }
      const draft = await createOrReuseGmailDraft({
        revisionId: raw.revisionId as string,
        to: raw.to as string,
        subject: raw.subject as string,
        body: raw.body as string,
      });
      return json(response, 200, {
        taskId: verified.auth.taskId,
        idempotencyKey: verified.auth.idempotencyKey,
        schemaVersion: 1,
        ...draft,
      });
    }

    const raw = payload as Record<string, unknown>;
    if (typeof raw.url !== "string") return json(response, 400, { error: "Planning URL is required" });
    const booleans = ["hasOfficialSnapshot", "applicationPrepared", "hasAcceptedContact", "outreachDraftReady", "gmailDraftCreated"] as const;
    if (booleans.some((key) => typeof raw[key] !== "boolean")) return json(response, 400, { error: "Planning state flags must be booleans" });

    const plan = planAgentTasks({
      url: raw.url,
      hasOfficialSnapshot: raw.hasOfficialSnapshot as boolean,
      applicationPrepared: raw.applicationPrepared as boolean,
      hasAcceptedContact: raw.hasAcceptedContact as boolean,
      outreachDraftReady: raw.outreachDraftReady as boolean,
      gmailDraftCreated: raw.gmailDraftCreated as boolean,
    });
    return json(response, 200, { taskId: verified.auth.taskId, idempotencyKey: verified.auth.idempotencyKey, plan });
  } catch (error) {
    console.error("Scout agent request rejected", { errorType: error instanceof Error ? error.name : typeof error });
    return json(response, 401, { error: "Unauthorized or invalid agent request" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Scout agent service listening on port ${port}`);
});
