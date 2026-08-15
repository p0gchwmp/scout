import { requireSameOriginMutation, requireScoutApiUser } from "../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;
  return Response.json({
    error: "Arbitrary discovery tokens are disabled. Register a controlled Greenhouse source and call POST /api/sync with its sourceId and an idempotencyKey.",
  }, { status: 410 });
}
