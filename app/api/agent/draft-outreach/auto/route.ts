import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { candidateClaims, contactEvidence, jobs, outreachDraftRevisions, outreachDrafts, profileEvidence } from "../../../../../db/schema";
import { buildAiOutreachEnvelope } from "../../../../../lib/scout/ai-agent";
import { createScoutAgentClientFromBindings } from "../../../../../lib/scout/agent-runtime";
import { hashDraftBody } from "../../../../../lib/scout/outreach";
import { evaluateResumeAlignment } from "../../../../../lib/scout/resume-alignment";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../../scout-api";

const AI_OUTREACH_TEMPLATE_VERSION = 4;

function contactId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const id = (value as Record<string, unknown>).contactId;
  if (typeof id !== "string" || !/^[A-Za-z0-9._:-]{3,160}$/.test(id.trim())) throw new Error("A valid contact id is required");
  if (Object.keys(value as Record<string, unknown>).some((key) => key !== "contactId")) throw new Error("Unexpected outreach field");
  return id.trim();
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let id: string;
  try { id = contactId(await request.json()); }
  catch { return Response.json({ error: "A valid accepted contact id is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [contact] = await db.select().from(contactEvidence).where(and(
      eq(contactEvidence.id, id),
      eq(contactEvidence.reviewState, "accepted"),
    )).limit(1);
    if (!contact) return Response.json({ error: "Accepted contact evidence is required before drafting outreach" }, { status: 409 });

    const [job] = await db.select().from(jobs).where(eq(jobs.id, contact.jobId)).limit(1);
    if (!job?.currentSnapshotId || job.currentSnapshotId !== contact.jobSnapshotId) {
      return Response.json({ error: "Contact evidence must be pinned to the current immutable job snapshot" }, { status: 409 });
    }

    const [existingRevision] = await db.select().from(outreachDraftRevisions).where(and(
      eq(outreachDraftRevisions.contactId, contact.id),
      eq(outreachDraftRevisions.jobSnapshotId, job.currentSnapshotId),
    )).limit(1);
    if (existingRevision) {
      const [existingDraft] = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, existingRevision.draftId)).limit(1);
      if (existingDraft && existingDraft.state !== "rejected") {
        return Response.json({ error: "A current outreach draft already exists for this accepted contact" }, { status: 409 });
      }
    }

    const [approvedClaims, verifiedProfile] = await Promise.all([
      db.select().from(candidateClaims).where(eq(candidateClaims.status, "approved")),
      db.select().from(profileEvidence).where(eq(profileEvidence.verified, true)),
    ]);
    const candidateName = verifiedProfile.find((field) => field.kind === "full_name")?.claim?.trim();
    if (!candidateName) return Response.json({ error: "Verified full_name profile evidence is required" }, { status: 409 });

    const alignment = evaluateResumeAlignment(job, approvedClaims);
    const relevantClaimIds = [...new Set(alignment.supportingClaims.flatMap((support) => support.claimIds))].slice(0, 4);
    const claims = approvedClaims.filter((claim) => relevantClaimIds.includes(claim.id));
    if (!claims.length) return Response.json({ error: "No approved role-relevant claims are available for outreach" }, { status: 409 });

    const envelope = buildAiOutreachEnvelope({
      jobSnapshotId: job.currentSnapshotId,
      companyName: job.company,
      roleTitle: job.title,
      candidateName,
      contact: {
        id: contact.id,
        email: contact.email,
        sourceUrl: contact.sourceUrl,
        excerpt: contact.excerpt,
        reviewState: "accepted",
      },
      claims: claims.map((claim) => ({ id: claim.id, statement: claim.statement, status: "approved" as const })),
      voice: {
        sample: verifiedProfile.find((field) => field.kind === "writing_sample")?.claim ?? null,
        styleNote: verifiedProfile.find((field) => field.kind === "writing_style_note")?.claim ?? null,
      },
    });

    const ai = await createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>).draftOutreach(envelope);
    const body = [`To: ${contact.email}`, `Subject: ${ai.subject}`, "", ai.body.trim()].join("\n");
    const now = new Date().toISOString();
    const draftId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const bodyHash = await hashDraftBody(body);

    await db.batch([
      db.insert(outreachDrafts).values({ id: draftId, jobId: job.id, state: "draft", createdAt: now, updatedAt: now }),
      db.insert(outreachDraftRevisions).values({
        id: revisionId,
        draftId,
        version: 1,
        templateVersion: AI_OUTREACH_TEMPLATE_VERSION,
        jobSnapshotId: job.currentSnapshotId,
        contactId: contact.id,
        claimIds: ai.usedClaimIds,
        body,
        bodyHash,
        createdAt: now,
      }),
    ]);

    return Response.json({
      draft: {
        id: draftId,
        state: "draft",
        revisionId,
        contactId: contact.id,
        jobId: job.id,
        claimIds: ai.usedClaimIds,
        body,
        model: ai.model,
        voiceSampleUsed: Boolean(envelope.voice.sample),
      },
      safety: { sendEmail: false, submitApplication: false },
    }, { status: 201 });
  } catch (error) {
    return scoutServerError("agent.draft-outreach-auto", error, "Unable to create humanized outreach draft");
  }
}
