import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { candidateClaims, contactEvidence, jobs, outreachDraftRevisions, outreachDrafts, profileEvidence } from "../../../../db/schema";
import { buildAiOutreachEnvelope } from "../../../../lib/scout/ai-agent";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { parseOutreachCreatePayload, PayloadValidationError } from "../../../../lib/scout/api-validation";
import { hashDraftBody } from "../../../../lib/scout/outreach";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const AI_OUTREACH_TEMPLATE_VERSION = 4;

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseOutreachCreatePayload>;
  try { payload = parseOutreachCreatePayload(await request.json()); }
  catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "A valid outreach draft request is required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!job?.currentSnapshotId) return Response.json({ error: "Current immutable job snapshot is required" }, { status: 409 });
    const [contact] = await db.select().from(contactEvidence).where(and(
      eq(contactEvidence.id, payload.contactId),
      eq(contactEvidence.jobId, job.id),
      eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
      eq(contactEvidence.reviewState, "accepted"),
    )).limit(1);
    if (!contact) return Response.json({ error: "Accepted contact evidence pinned to the current snapshot is required" }, { status: 409 });

    const [claims, voiceRows] = await Promise.all([
      db.select().from(candidateClaims).where(inArray(candidateClaims.id, payload.claimIds)),
      db.select().from(profileEvidence).where(eq(profileEvidence.verified, true)),
    ]);
    if (claims.length !== payload.claimIds.length || claims.some((claim) => claim.status !== "approved")) {
      return Response.json({ error: "Every candidate claim supplied to AI must be approved" }, { status: 409 });
    }
    const writingSample = voiceRows.find((field) => field.kind === "writing_sample")?.claim ?? null;
    const writingStyleNote = voiceRows.find((field) => field.kind === "writing_style_note")?.claim ?? null;

    const envelope = buildAiOutreachEnvelope({
      jobSnapshotId: job.currentSnapshotId,
      companyName: job.company,
      roleTitle: job.title,
      candidateName: payload.candidateName,
      contact: {
        id: contact.id,
        email: contact.email,
        sourceUrl: contact.sourceUrl,
        excerpt: contact.excerpt,
        reviewState: "accepted",
      },
      claims: claims.map((claim) => ({ id: claim.id, statement: claim.statement, status: "approved" as const })),
      voice: { sample: writingSample, styleNote: writingStyleNote },
    });
    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const ai = await client.draftOutreach(envelope);
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
        revision: {
          id: revisionId,
          version: 1,
          templateVersion: AI_OUTREACH_TEMPLATE_VERSION,
          jobSnapshotId: job.currentSnapshotId,
          contactId: contact.id,
          claimIds: ai.usedClaimIds,
          body,
          bodyHash,
          createdAt: now,
        },
        ai: { model: ai.model, humanWritingStyleVersion: envelope.constraints.humanWritingStyleVersion, voiceSampleUsed: Boolean(envelope.voice.sample) },
      },
    }, { status: 201 });
  } catch (error) {
    return scoutServerError("agent.draft-outreach", error, "AI outreach drafting failed");
  }
}
