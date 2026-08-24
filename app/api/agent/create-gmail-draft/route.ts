import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { outreachDraftRevisions, outreachDrafts } from "../../../../db/schema";
import { createGmailDraftThroughAgent } from "../../../../lib/scout/gmail-agent-client";
import { parseOutreachDraftForEmail } from "../../../../lib/scout/gmail-compose";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

function draftId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const id = (value as Record<string, unknown>).draftId;
  if (typeof id !== "string" || !/^[A-Za-z0-9._:-]{3,160}$/.test(id.trim())) throw new Error("A valid draft id is required");
  return id.trim();
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let id: string;
  try { id = draftId(await request.json()); }
  catch { return Response.json({ error: "A valid approved outreach draft id is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [draft] = await db.select().from(outreachDrafts).where(and(
      eq(outreachDrafts.id, id),
      eq(outreachDrafts.state, "approved"),
    )).limit(1);
    if (!draft?.approvedRevisionId) {
      return Response.json({ error: "Only an approved outreach draft can create a Gmail draft" }, { status: 409 });
    }

    const [revision] = await db.select().from(outreachDraftRevisions).where(and(
      eq(outreachDraftRevisions.id, draft.approvedRevisionId),
      eq(outreachDraftRevisions.draftId, draft.id),
    )).limit(1);
    if (!revision) return Response.json({ error: "Approved outreach revision is missing" }, { status: 409 });

    const email = parseOutreachDraftForEmail(revision.body);
    const result = await createGmailDraftThroughAgent(env as unknown as Record<string, unknown>, {
      revisionId: revision.id,
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
        outreachDraftId: draft.id,
        outreachRevisionId: revision.id,
      },
      safety: { sendEmail: false, submitApplication: false },
    }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return scoutServerError("agent.create-gmail-draft", error, "Unable to create Gmail draft");
  }
}
