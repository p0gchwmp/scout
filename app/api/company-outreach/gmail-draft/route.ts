import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { candidateClaims, profileEvidence } from "../../../../db/schema";
import {
  companyOutreachContacts,
  companyOutreachDraftRevisions,
  companyOutreachDrafts,
  companyOutreachTargets,
} from "../../../../db/company-outreach-schema";
import { selectUsableApprovedClaims } from "../../../../lib/scout/claims";
import { createGmailDraftThroughAgent } from "../../../../lib/scout/gmail-agent-client";
import { parseOutreachDraftForEmail } from "../../../../lib/scout/gmail-compose";
import {
  companyOutreachExecutionIssues,
  parsePinnedOutreachClaimIds,
} from "../../../../lib/scout/outreach-execution";
import { hashDraftBody } from "../../../../lib/scout/outreach";
import { outreachIdentityExecutionIssues } from "../../../../lib/scout/outreach-profile-freshness";
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
    const [target] = await db.select().from(companyOutreachTargets).where(eq(companyOutreachTargets.id, draft.targetId)).limit(1);
    if (!target) return Response.json({ error: "Company outreach target is missing" }, { status: 409 });
    const [revision] = await db.select().from(companyOutreachDraftRevisions).where(and(
      eq(companyOutreachDraftRevisions.id, draft.approvedRevisionId),
      eq(companyOutreachDraftRevisions.draftId, draft.id),
      eq(companyOutreachDraftRevisions.targetId, target.id),
    )).limit(1);
    if (!revision) return Response.json({ error: "Approved company outreach revision is missing" }, { status: 409 });

    const claimIds = parsePinnedOutreachClaimIds(revision.claimIds);
    if (!claimIds) return Response.json({ error: "Approved company outreach revision has invalid pinned claim bindings" }, { status: 409 });

    const [contact, claims, currentIdentityFields] = await Promise.all([
      db.select().from(companyOutreachContacts).where(eq(companyOutreachContacts.id, revision.contactId)).limit(1).then((rows) => rows[0]),
      db.select().from(candidateClaims).where(inArray(candidateClaims.id, claimIds)),
      db.select().from(profileEvidence).where(eq(profileEvidence.kind, "full_name")),
    ]);
    const usableClaims = selectUsableApprovedClaims(claims);

    let email: ReturnType<typeof parseOutreachDraftForEmail>;
    try { email = parseOutreachDraftForEmail(revision.body); }
    catch { return Response.json({ error: "Approved company outreach revision is malformed and must be regenerated" }, { status: 409 }); }

    const bindingIssues = companyOutreachExecutionIssues({
      targetId: target.id,
      targetState: target.state,
      revisionTargetId: revision.targetId,
      revisionContactId: revision.contactId,
      revisionClaimIds: claimIds,
      currentUsableClaimIds: usableClaims.map((claim) => claim.id),
      contact,
      parsedRecipient: email.to,
      expectedBodyHash: revision.bodyHash,
      actualBodyHash: await hashDraftBody(revision.body),
    });
    const identityIssues = outreachIdentityExecutionIssues({
      revisionCreatedAt: revision.createdAt,
      currentProfileFields: currentIdentityFields,
    });
    const executionIssues = [...new Set([...bindingIssues, ...identityIssues])];
    if (executionIssues.length) {
      return Response.json({
        error: "Approved company outreach evidence or verified identity changed; refresh and re-approve the draft before creating a Gmail draft",
        bindingIssues: executionIssues,
      }, { status: 409 });
    }

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
