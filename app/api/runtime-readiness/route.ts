import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { buildRuntimeReadiness, type RuntimeCoreReadiness } from "../../../lib/scout/runtime-readiness";
import { logScoutError, requireScoutApiUser } from "../../scout-api";

const REQUIRED_TABLES = [
  "company_sources",
  "sync_runs",
  "jobs",
  "job_snapshots",
  "contact_evidence",
  "candidate_claims",
  "outreach_drafts",
  "outreach_draft_revisions",
  "applications",
  "profile_evidence",
] as const;

const REQUIRED_IMMUTABILITY_TRIGGERS = [
  "job_snapshots_immutable_update",
  "job_snapshots_immutable_delete",
  "candidate_claims_approved_immutable_update",
  "candidate_claims_approved_immutable_delete",
  "outreach_revisions_immutable_update",
  "outreach_revisions_immutable_delete",
] as const;

type D1Row = { type?: unknown; name?: unknown };
type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};
type D1Like = { prepare(query: string): D1StatementLike };

function blockedCore(detail: string): RuntimeCoreReadiness {
  return {
    database: { state: "blocked", configured: false, required: true, detail },
    schema: { state: "blocked", configured: false, required: true, detail: "Core Scout schema could not be verified.", missing: [...REQUIRED_TABLES] },
    immutableEvidence: {
      state: "blocked",
      configured: false,
      required: true,
      detail: "Immutable evidence protections could not be verified.",
      missing: [...REQUIRED_IMMUTABILITY_TRIGGERS],
    },
  };
}

async function inspectCoreRuntime(): Promise<RuntimeCoreReadiness> {
  const bindings = env as unknown as Record<string, unknown>;
  const d1 = bindings.DB as D1Like | undefined;
  if (!d1 || typeof d1.prepare !== "function") {
    return blockedCore("Cloudflare D1 binding is unavailable.");
  }

  try {
    getDb();
    await d1.prepare("SELECT 1 AS ok").all();
  } catch (error) {
    logScoutError("runtime-readiness.database", error);
    return blockedCore("Cloudflare D1 binding or database access is unavailable.");
  }

  try {
    const requiredNames = [...REQUIRED_TABLES, ...REQUIRED_IMMUTABILITY_TRIGGERS];
    const placeholders = requiredNames.map(() => "?").join(",");
    const result = await d1
      .prepare(`SELECT type, name FROM sqlite_master WHERE name IN (${placeholders})`)
      .bind(...requiredNames)
      .all<D1Row>();
    const rows = Array.isArray(result.results) ? result.results : [];
    const tables = new Set(rows.filter((row) => row.type === "table" && typeof row.name === "string").map((row) => row.name as string));
    const triggers = new Set(rows.filter((row) => row.type === "trigger" && typeof row.name === "string").map((row) => row.name as string));
    const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
    const missingTriggers = REQUIRED_IMMUTABILITY_TRIGGERS.filter((name) => !triggers.has(name));

    return {
      database: { state: "ready", configured: true, required: true, detail: "Cloudflare D1 is reachable through Scout's database layer." },
      schema: missingTables.length
        ? { state: "blocked", configured: true, required: true, detail: "Required Scout tables are missing.", missing: missingTables }
        : { state: "ready", configured: true, required: true, detail: "Required Scout tables are present." },
      immutableEvidence: missingTriggers.length
        ? { state: "blocked", configured: true, required: true, detail: "Required immutability triggers are missing.", missing: missingTriggers }
        : { state: "ready", configured: true, required: true, detail: "Job snapshots, approved claims, and outreach revisions retain their immutability triggers." },
    };
  } catch (error) {
    logScoutError("runtime-readiness.schema", error);
    return {
      database: { state: "ready", configured: true, required: true, detail: "Cloudflare D1 is reachable through Scout's database layer." },
      schema: { state: "blocked", configured: true, required: true, detail: "Core Scout schema could not be verified.", missing: [...REQUIRED_TABLES] },
      immutableEvidence: {
        state: "blocked",
        configured: true,
        required: true,
        detail: "Immutable evidence protections could not be verified.",
        missing: [...REQUIRED_IMMUTABILITY_TRIGGERS],
      },
    };
  }
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;

  const core = await inspectCoreRuntime();
  const readiness = buildRuntimeReadiness(env as unknown as Record<string, unknown>, core);
  return Response.json(readiness, { headers: { "cache-control": "no-store" } });
}
