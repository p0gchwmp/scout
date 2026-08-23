import { D1ScoutSyncStore } from "../../../lib/scout/d1-sync-store";
import { parseSyncPayload } from "../../../lib/scout/api-validation";
import { discoverRegisteredSource } from "../../../lib/scout/greenhouse";
import { SyncInProgressError, synchronizeSource } from "../../../lib/scout/sync";
import { logScoutError, requireSameOriginMutation, requireScoutApiUser } from "../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  let payload: ReturnType<typeof parseSyncPayload>;
  try { payload = parseSyncPayload(await request.json()); }
  catch { return Response.json({ error: "A valid sync request body is required" }, { status: 400 }); }

  try {
    const run = await synchronizeSource(new D1ScoutSyncStore(), discoverRegisteredSource, {
      sourceId: payload.sourceId,
      idempotencyKey: payload.idempotencyKey,
      observedAt: new Date().toISOString(),
    });
    return Response.json({ run }, { status: run.status === "completed" ? 200 : 202 });
  } catch (error) {
    logScoutError("sync.source", error);
    if (error instanceof SyncInProgressError) return Response.json({ error: "A sync is already running for this source" }, { status: 409 });
    if (error instanceof Error && error.message === "Enabled registered source not found") return Response.json({ error: "Enabled registered source not found" }, { status: 404 });
    return Response.json({ error: "Source sync failed" }, { status: 502 });
  }
}
