import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { candidateClaims, contactEvidence, jobs, outreachDraftRevisions, outreachDrafts, profileEvidence } from "../../../db/schema";
import {
  parseOutreachCreatePayload,
  parseOutreachMutationPayload,
  PayloadValidationError,
} from "../../../lib/scout/api-validation";
import { selectUsableApprovedClaims } from "../../../lib/scout/claims";
import { combineOutreachAndCoverLetter, renderCoverLetter } from "../../../lib/scout/cover-letter";
import {
  OUTREACH_TEMPLATE_VERSION,
  approveDraft,
  hashDraftBody,
  rejectDraft,
  renderOutreachDraft,
  type OutreachDraft,
} from "../../../lib/scout/outreach";
import { verifiedOutreachCandidateName } from "../../../lib/scout/outreach-profile-freshness";
import { logScoutError, requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

async function loadDraft(db: ReturnType<typeof getDb>, id: string): Promise<OutreachDraft | undefined> {
  const [draft] = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).limit(1);
  if (!draft) return undefined;
  const revisions = await db.select().from(outreachDraftRevisions).where(eq(outreachDraftRevisions.draftId, id)).orderBy(asc(outreachDraftRevisions.version));
  return {
    id: draft.id,
    state: draft.state,
    approvedRevisionId: draft.approvedRevisionId,
    approvedAt: draft.approvedAt,
    rejectedAt: draft.rejectedAt,
    revisions: revisions.map((revision) => ({
      id: revision.id,
      version: revision.version,
      body: revision.body,
      jobSnapshotId: revision.jobSnapshotId,
      contactId: revision.contactId,
      claimIds: revision.claimIds,
      createdAt: revision.createdAt,
    })),
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new PayloadValidationError("A JSON body is required");
  }
}

async function withVerifiedCandidateName(raw: unknown, db: ReturnType<typeof getDb>) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const current = raw as Record<string, unknown>;
  const identityFields = await db.select().from(profileEvidence).where(and(
    eq(profileEvidence.kind, "full_name"),
    eq(profileEvidence.verified, true),
  ));
  try {
    const candidateName = verifiedOutreachCandidateName(
      identityFields,
      typeof current.candidateName === "string" ? current.candidateName : null,
    );
    return { ...current, candidateName };
  } catch (error) {
    throw new PayloadValidationError(error instanceof Error ? error.message : "Current verified full_name is required for outreach");
  }
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try {
    const db = getDb();
    const drafts = await db.select().from(outreachDrafts).orderBy(desc(outreachDrafts.updatedAt)).limit(100);
    const revisions = drafts.length
      ? await db.select().from(outreachDraftRevisions).where(inArray(outreachDraftRevisions.draftId, drafts.map((draft) => draft.id))).orderBy(asc(outreachDraftRevisions.version))
      : [];
    return Response.json({ drafts: drafts.map((draft) => ({ ...draft, revisions: revisions.filter((revision) => revision.draftId === draft.id) })) });
  } catch (error) {
    return scoutServerError("outreach.list", error, "Unable to load drafts");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  let payload: ReturnType<typeof parseOutreachCreatePayload>;
  try {
    const raw = await readJson(request);
    payload = parseOutreachCreatePayload(await withVerifiedCandidateName(raw, db));
  } catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!job?.currentSnapshotId) return Response.json({ error: "Current job snapshot not found" }, { status: 404 });
    const [contact] = await db.select().from(contactEvidence).where(and(
      eq(contactEvidence.id, payload.contactId),
      eq(contactEvidence.jobId, job.id),
      eq(contactEvidence.jobSnapshotId, job.currentSnapshotId),
      eq(contactEvidence.reviewState, "accepted"),
    )).limit(1);
    if (!contact) return Response.json({ error: "An accepted contact pinned to the current job snapshot is required" }, { status: 409 });
    const [claims, verifiedProfile] = await Promise.all([
      db.select().from(candidateClaims).where(inArray(candidateClaims.id, payload.claimIds)),
      db.select().from(profileEvidence).where(eq(profileEvidence.verified, true)),
    ]);
    const usableClaims = selectUsableApprovedClaims(claims, { allowSyntheticDemo: job.id.startsWith("demo_job_") });
    if (claims.length !== payload.claimIds.length || usableClaims.length !== payload.claimIds.length) {
      return Response.json({ error: "Every pinned claim must exist, be approved, non-synthetic for live roles, and have any numbers anchored in its evidence" }, { status: 409 });
    }

    const rendered = renderOutreachDraft({
      candidateName: payload.candidateName,
      companyName: job.company,
      roleTitle: job.title,
      contactEmail: contact.email,
      jobSnapshotId: job.currentSnapshotId,
      contactId: contact.id,
      claims: usableClaims.map((claim) => ({ id: claim.id, statement: claim.statement })),
    });
    const coverLetter = renderCoverLetter({
      candidateName: payload.candidateName,
      companyName: job.company,
      roleTitle: job.title,
      purpose: "formal_role",
      opportunityContext: job.description,
      profile: {
        university: verifiedProfile.find((field) => field.kind === "university")?.claim ?? null,
        program: verifiedProfile.find((field) => field.kind === "program")?.claim ?? null,
        graduationYear: verifiedProfile.find((field) => field.kind === "graduation_year")?.claim ?? null,
        currentLocation: verifiedProfile.find((field) => field.kind === "current_location")?.claim ?? null,
      },
      claims: usableClaims.map((claim) => ({ id: claim.id, statement: claim.statement })),
    });
    const combinedBody = combineOutreachAndCoverLetter(rendered.body, coverLetter.body);
    const pinnedClaimIds = [...new Set([...rendered.claimIds, ...coverLetter.claimIds])].sort();
    const now = new Date().toISOString();
    const draftId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await db.batch([
      db.insert(outreachDrafts).values({ id: draftId, jobId: job.id, state: "draft", createdAt: now, updatedAt: now }),
      db.insert(outreachDraftRevisions).values({
        id: revisionId,
        draftId,
        version: 1,
        templateVersion: OUTREACH_TEMPLATE_VERSION,
        jobSnapshotId: rendered.jobSnapshotId,
        contactId: rendered.contactId,
        claimIds: pinnedClaimIds,
        body: combinedBody,
        bodyHash: await hashDraftBody(combinedBody),
        createdAt: now,
      }),
    ]);
    return Response.json({ draft: await loadDraft(db, draftId), includesCoverLetter: true }, { status: 201 });
  } catch (error) {
    logScoutError("outreach.create", error);
    return Response.json({ error: "Unable to create draft from current accepted evidence" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseOutreachMutationPayload>;
  try {
    payload = parseOutreachMutationPayload(await readJson(request));
  } catch (error) {
    if (error instanceof PayloadValidationError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const db = getDb();
    const current = await loadDraft(db, payload.id);
    if (!current) return Response.json({ error: "Draft not found" }, { status: 404 });
    const latest = current.revisions.at(-1);
    if (!latest || payload.revisionId !== latest.id) {
      return Response.json({ error: "Draft revision is stale; reload and retry" }, { status: 409 });
    }

    const now = new Date().toISOString();
    if (payload.action === "approve") {
      const next = approveDraft(current, payload.revisionId, now);
      const [draft] = await db.update(outreachDrafts).set({
        state: next.state,
        approvedRevisionId: payload.revisionId,
        approvedAt: now,
        rejectedAt: null,
        updatedAt: now,
      }).where(and(eq(outreachDrafts.id, current.id), eq(outreachDrafts.state, "draft"))).returning();
      if (!draft) return Response.json({ error: "Draft changed; reload and retry" }, { status: 409 });
    } else {
      const next = rejectDraft(current, now);
      const [draft] = await db.update(outreachDrafts).set({
        state: next.state,
        approvedRevisionId: null,
        rejectedAt: now,
        approvedAt: null,
        updatedAt: now,
      }).where(and(eq(outreachDrafts.id, current.id), eq(outreachDrafts.state, "draft"))).returning();
      if (!draft) return Response.json({ error: "Draft changed; reload and retry" }, { status: 409 });
    }
    return Response.json({ draft: await loadDraft(db, current.id) });
  } catch (error) {
    logScoutError("outreach.update", error);
    return Response.json({ error: "Draft or pinned evidence changed; reload and retry" }, { status: 409 });
  }
}
