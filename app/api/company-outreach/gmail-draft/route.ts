import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companyOutreachDraftRevisions, companyOutreachDrafts, companyOutreachTargets } from "../../../../db/company-outreach-schema";
import { createGmailDraftThroughAgent } from "../../../../lib/scout/gmail-agent-client";
import { parseOutreachDraftForEmail } from "../../../../lib/scout/gmail-compose";
import { parseCompanyGmailDraftPayload } from "../../../../lib/scout/company-outreach";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let draftId: string;
  try { ({ draftId } = parseCompanyGmailDraftPayload(await request.json())); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "A valid approved draft id is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [draft] = await db.select().from(companyOutreachDrafts).where(and(
      eq(companyOutreachDrafts.id, draftId),
      eq(companyOutreachDrafts.state, "approved"),
    )).limit(1);
    if (!draft?.approvedRevisionId) return Response.json({ error: "Only an approved company outreach draft can create a Gmail draft" }, { status: 409 });
    const [target] = await db.select().from(companyOutreachTargets).where(and(
      eq(companyOutreachTargets.id, draft.targetId),
      eq(companyOutreachTargets.state, "active"),
    )).limit(1);
    if (!target) return Response.json({ error: "Company outreach target is no longer active" }, { status: 409 });
    const [revision] = await db.select().from(companyOutreachDraftRevisions).where(and(
      eq(companyOutreachDraftRevisions.id, draft.approvedRevisionId),
      eq(companyOutreachDraftRevisions.draftId, draft.id),
      eq(companyOutreachDraftRevisions.targetId, target.id),
    )).limit(1);
    if (!revision) return Response.json({ error: "Approved company outreach revision is missing" }, { status: 409 });

    const email = parseOutreachDraftForEmail(revision.body);
    const result = await createGmailDraftThroughAgent(env as unknown as Record<string, unknown>, {
      revisionId: `company-outreach-${revision.id}`,
      to: email.to,
      subject: email.subject,
      body: email.body,
    });
    return Response.json({
      gmailDraft: {
        draftId: result.draftId,
        messageId: result.messageId,
        scoutMessageId: result.scoutMessageId,
        reused: result.reused,
        companyOutreachDraftId: draft.id,
        companyOutreachRevisionId: revision.id,
      },
    }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return scoutServerError("company-outreach.gmail-draft", error, "Unable to create company outreach Gmail draft");
  }
}
