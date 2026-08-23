import { createServer } from "node:http";
import { AGENT_EXECUTION_CAPABILITIES, planAgentTasks } from "../lib/scout/agent-task-planner.ts";
import { AGENT_SERVICE_CAPABILITIES, InMemoryAgentReplayGuard, verifyAgentServiceRequest } from "../lib/scout/agent-service-auth.ts";
import { runAgentDiscovery } from "./discovery.ts";
import { researchPublishedCompanyContacts } from "./contact-research.ts";

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

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, {
        service: "scout-agent",
        status: "ok",
        capabilities: { ...AGENT_EXECUTION_CAPABILITIES, ...AGENT_SERVICE_CAPABILITIES },
      });
    }

    if (request.method !== "POST" || !["/v1/plan", "/v1/discover", "/v1/research-contacts"].includes(request.url ?? "")) return json(response, 404, { error: "Not found" });
    const rawBody = await readBody(request);
    const verified = await verifyAgentServiceRequest(toWebRequest(request, rawBody), secret);
    const expectedOperation = request.url === "/v1/plan" ? "plan_job" : request.url === "/v1/discover" ? "discover_internships" : "research_contacts";
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
