import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { candidateClaims, contactEvidence, jobs, outreachDraftRevisions, outreachDrafts } from "../../../../db/schema";
import { selectUsableApprovedClaims } from "../../../../lib/scout/claims";
import { createGmailDraftThroughAgent } from "../../../../lib/scout/gmail-agent-client";
import { parseOutreachDraftForEmail } from "../../../../lib/scout/gmail-compose";
import {
  jobOutreachExecutionIssues,
  parsePinnedOutreachClaimIds,
} from "../../../../lib/scout/outreach-execution";
import { hashDraftBody } from "../../../../lib/scout/outreach";
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

    const claimIds = parsePinnedOutreachClaimIds(revision.claimIds);
    if (!claimIds) return Response.json({ error: "Approved outreach revision has invalid pinned claim bindings" }, { status: 409 });

    const [job, contact, claims] = await Promise.all([
      db.select().from(jobs).where(eq(jobs.id, draft.jobId)).limit(1).then((rows) => rows[0]),
      db.select().from(contactEvidence).where(eq(contactEvidence.id, revision.contactId)).limit(1).then((rows) => rows[0]),
      db.select().from(candidateClaims).where(inArray(candidateClaims.id, claimIds)),
    ]);
    const usableClaims = selectUsableApprovedClaims(claims, { allowSyntheticDemo: draft.jobId.startsWith("demo_job_") });

    let email: ReturnType<typeof parseOutreachDraftForEmail>;
    try { email = parseOutreachDraftForEmail(revision.body); }
    catch { return Response.json({ error: "Approved outreach revision is malformed and must be regenerated" }, { status: 409 }); }

    const bindingIssues = jobOutreachExecutionIssues({
      jobId: draft.jobId,
      currentJobSnapshotId: job?.currentSnapshotId,
      revisionJobSnapshotId: revision.jobSnapshotId,
      revisionContactId: revision.contactId,
      revisionClaimIds: claimIds,
      currentUsableClaimIds: usableClaims.map((claim) => claim.id),
      contact,
      parsedRecipient: email.to,
      expectedBodyHash: revision.bodyHash,
      actualBodyHash: await hashDraftBody(revision.body),
    });
    if (bindingIssues.length) {
      return Response.json({
        error: "Approved outreach evidence changed; refresh and re-approve the outreach draft before creating a Gmail draft",
        bindingIssues,
      }, { status: 409 });
    }

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
