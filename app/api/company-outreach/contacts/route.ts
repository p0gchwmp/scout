import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companyOutreachContacts } from "../../../../db/company-outreach-schema";
import { parseCompanyContactReviewPayload } from "../../../../lib/scout/company-outreach";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const contacts = await getDb().select().from(companyOutreachContacts).orderBy(desc(companyOutreachContacts.extractedAt)).limit(250);
    return Response.json({ contacts });
  } catch (error) {
    return scoutServerError("company-outreach.contacts.list", error, "Unable to load company outreach contacts");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseCompanyContactReviewPayload>;
  try { payload = parseCompanyContactReviewPayload(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid contact review" }, { status: 400 }); }

  try {
    const [contact] = await getDb().update(companyOutreachContacts)
      .set({ reviewState: payload.reviewState })
      .where(eq(companyOutreachContacts.id, payload.id))
      .returning();
    if (!contact) return Response.json({ error: "Company outreach contact not found" }, { status: 404 });
    return Response.json({ contact });
  } catch (error) {
    return scoutServerError("company-outreach.contacts.review", error, "Unable to review company outreach contact");
  }
}
