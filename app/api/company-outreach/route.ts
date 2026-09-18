import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { companyOutreachTargets } from "../../../db/company-outreach-schema";
import { parseCompanyTargetCreatePayload } from "../../../lib/scout/company-outreach";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const targets = await getDb().select().from(companyOutreachTargets).orderBy(desc(companyOutreachTargets.createdAt)).limit(250);
    return Response.json({ targets });
  } catch (error) {
    return scoutServerError("company-outreach.list", error, "Unable to load company outreach targets");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseCompanyTargetCreatePayload>;
  try { payload = parseCompanyTargetCreatePayload(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid company outreach target" }, { status: 400 }); }

  try {
    const db = getDb();
    const now = new Date().toISOString();
    const [created] = await db.insert(companyOutreachTargets).values({
      id: crypto.randomUUID(),
      ...payload,
      state: "active",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning();
    if (created) return Response.json({ target: created, created: true }, { status: 201 });
    const [existing] = await db.select().from(companyOutreachTargets).where(and(
      eq(companyOutreachTargets.companyDomain, payload.companyDomain),
      eq(companyOutreachTargets.track, payload.track),
    )).limit(1);
    if (!existing) return Response.json({ error: "Company outreach target conflict could not be resolved" }, { status: 409 });
    return Response.json({ target: existing, created: false });
  } catch (error) {
    return scoutServerError("company-outreach.create", error, "Unable to create company outreach target");
  }
}
