import { getDb } from "../../../db";
import { jobs } from "../../../db/schema";
import { requireScoutApiUser, scoutServerError } from "../../scout-api";

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;

  try {
    await getDb().select({ id: jobs.id }).from(jobs).limit(1);
    return Response.json({
      status: "ok",
      database: "ok",
      ownerOnly: true,
      externalSideEffects: {
        applicationSubmission: false,
        emailSending: false,
      },
    });
  } catch (error) {
    return scoutServerError("health.readiness", error, "Scout readiness check failed");
  }
}
