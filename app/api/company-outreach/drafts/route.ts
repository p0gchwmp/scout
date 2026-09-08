import { env } from "cloudflare:workers";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { candidateClaims, profileEvidence } from "../../../../db/schema";
import {
  companyOutreachContacts,
  companyOutreachDraftRevisions,
  companyOutreachDrafts,
  companyOutreachTargets,
} from "../../../../db/company-outreach-schema";
import { buildAiOutreachEnvelope } from "../../../../lib/scout/ai-agent";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { selectUsableApprovedClaims } from "../../../../lib/scout/claims";
import {
  assertSpeculativeCompanyOutreach,
  companyOutreachRoleLabel,
  parseCompanyDraftCreatePayload,
  parseCompanyDraftReviewPayload,
  renderCompanyFirstOutreach,
  selectCompanyOutreachClaimIds,
} from "../../../../lib/scout/company-outreach";
import { combineOutreachAndCoverLetter, renderCoverLetter } from "../../../../lib/scout/cover-letter";
import { hashDraftBody } from "../../../../lib/scout/outreach";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

const COMPANY_OUTREACH_TEMPLATE_VERSION = 3;

async function listDrafts() {
  const db = getDb();
  const drafts = await db.select().from(companyOutreachDrafts).orderBy(desc(companyOutreachDrafts.updatedAt)).limit(100);
  const revisions = drafts.length
    ? await db.select().from(companyOutreachDraftRevisions)
      .where(inArray(companyOutreachDraftRevisions.draftId, drafts.map((draft) => draft.id)))
      .orderBy(asc(companyOutreachDraftRevisions.version))
    : [];
  return drafts.map((draft) => ({ ...draft, revisions: revisions.filter((revision) => revision.draftId === draft.id) }));
}

export async function GET() {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  try { return Response.json({ drafts: await listDrafts() }); }
  catch (error) { return scoutServerError("company-outreach.drafts.list", error, "Unable to load company outreach drafts"); }
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseCompanyDraftCreatePayload>;
  try { payload = parseCompanyDraftCreatePayload(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid company outreach draft request" }, { status: 400 }); }

  try {
    const db = getDb();
    const [contact] = await db.select().from(companyOutreachContacts).where(and(
      eq(companyOutreachContacts.id, payload.contactId),
      eq(companyOutreachContacts.reviewState, "accepted"),
    )).limit(1);
    if (!contact) return Response.json({ error: "Accepted published company contact evidence is required" }, { status: 409 });
    const [target] = await db.select().from(companyOutreachTargets).where(and(
      eq(companyOutreachTargets.id, contact.targetId),
      eq(companyOutreachTargets.state, "active"),
    )).limit(1);
    if (!target) return Response.json({ error: "Active company outreach target is required" }, { status: 409 });

    const [allClaims, verifiedProfile] = await Promise.all([
      db.select().from(candidateClaims),
      db.select().from(profileEvidence).where(eq(profileEvidence.verified, true)),
    ]);
    const allUsableClaims = selectUsableApprovedClaims(allClaims);
    const selectedClaimIds = payload.claimIds ?? selectCompanyOutreachClaimIds({
      claims: allUsableClaims.map((claim) => ({ id: claim.id, statement: claim.statement })),
      companyName: target.companyName,
      researchFocus: target.researchFocus,
      track: target.track,
      limit: 3,
    });
    if (!selectedClaimIds.length) {
      return Response.json({ error: "Scout could not find a defensible approved-claim match for this company. Use the advanced claim override rather than inventing relevance." }, { status: 409 });
    }
    const usableClaims = allUsableClaims.filter((claim) => selectedClaimIds.includes(claim.id));
    if (usableClaims.length !== selectedClaimIds.length) {
      return Response.json({ error: "Every selected claim must be approved, live-safe, and evidence-anchored" }, { status: 409 });
    }
    const candidateName = verifiedProfile.find((field) => field.kind === "full_name")?.claim?.trim();
    if (!candidateName) return Response.json({ error: "Verified full_name profile evidence is required" }, { status: 409 });

    const coverProfile = {
      university: verifiedProfile.find((field) => field.kind === "university")?.claim ?? null,
      program: verifiedProfile.find((field) => field.kind === "program")?.claim ?? null,
      graduationYear: verifiedProfile.find((field) => field.kind === "graduation_year")?.claim ?? null,
      currentLocation: verifiedProfile.find((field) => field.kind === "current_location")?.claim ?? null,
    };
    const roleLabel = companyOutreachRoleLabel(target.track);
    const opportunityContext = target.interestNote ?? target.researchFocus ?? null;

    let rendered = renderCompanyFirstOutreach({
      candidateName,
      companyName: target.companyName,
      track: target.track,
      interestNote: target.interestNote,
      contactEmail: contact.email,
      claims: usableClaims.map((claim) => ({ id: claim.id, statement: claim.statement })),
    });
    let model = "deterministic-company-first";
    let deterministicFallback = true;

    try {
      const envelope = buildAiOutreachEnvelope({
        jobSnapshotId: `company-target:${target.id}`,
        companyName: target.companyName,
        roleTitle: roleLabel,
        candidateName,
        contact: {
          id: contact.id,
          email: contact.email,
          sourceUrl: contact.sourceUrl,
          excerpt: contact.excerpt,
          reviewState: "accepted",
        },
        claims: usableClaims.map((claim) => ({ id: claim.id, statement: claim.statement, status: "approved" as const })),
        voice: {
          sample: verifiedProfile.find((field) => field.kind === "writing_sample")?.claim ?? null,
          styleNote: verifiedProfile.find((field) => field.kind === "writing_style_note")?.claim ?? null,
        },
      });
      const ai = await createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>).draftOutreach(envelope);
      const aiClaims = usableClaims.filter((claim) => ai.usedClaimIds.includes(claim.id));
      const coverLetter = renderCoverLetter({
        candidateName,
        companyName: target.companyName,
        roleTitle: roleLabel,
        purpose: "speculative_company",
        opportunityContext,
        profile: coverProfile,
        claims: (aiClaims.length ? aiClaims : usableClaims).map((claim) => ({ id: claim.id, statement: claim.statement })),
      });
      const candidateEmail = [`To: ${contact.email}`, `Subject: ${ai.subject}`, "", ai.body.trim()].join("\n");
      const candidateBody = combineOutreachAndCoverLetter(candidateEmail, coverLetter.body);
      assertSpeculativeCompanyOutreach(candidateBody);
      rendered = { body: candidateBody, claimIds: [...new Set([...ai.usedClaimIds, ...coverLetter.claimIds])].sort() };
      model = ai.model ?? "cloud-ai";
      deterministicFallback = false;
    } catch {
      const coverLetter = renderCoverLetter({
        candidateName,
        companyName: target.companyName,
        roleTitle: roleLabel,
        purpose: "speculative_company",
        opportunityContext,
        profile: coverProfile,
        claims: usableClaims.map((claim) => ({ id: claim.id, statement: claim.statement })),
      });
      rendered = {
        body: combineOutreachAndCoverLetter(rendered.body, coverLetter.body),
        claimIds: [...new Set([...rendered.claimIds, ...coverLetter.claimIds])].sort(),
      };
      assertSpeculativeCompanyOutreach(rendered.body);
      // Company-first outreach remains usable when cloud AI is absent or returns unsupported/speculative-invalid copy.
    }

    const now = new Date().toISOString();
    const draftId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await db.batch([
      db.insert(companyOutreachDrafts).values({ id: draftId, targetId: target.id, state: "draft", createdAt: now, updatedAt: now }),
      db.insert(companyOutreachDraftRevisions).values({
        id: revisionId,
        draftId,
        targetId: target.id,
        version: 1,
        templateVersion: COMPANY_OUTREACH_TEMPLATE_VERSION,
        contactId: contact.id,
        claimIds: rendered.claimIds,
        body: rendered.body,
        bodyHash: await hashDraftBody(rendered.body),
        createdAt: now,
      }),
    ]);

    return Response.json({
      draft: {
        id: draftId,
        targetId: target.id,
        revisionId,
        body: rendered.body,
        claimIds: rendered.claimIds,
        model,
        deterministicFallback,
        claimSelection: payload.claimIds ? "manual_override" : "automatic",
        includesCoverLetter: true,
      },
    }, { status: 201 });
  } catch (error) {
    return scoutServerError("company-outreach.drafts.create", error, "Unable to create company-first outreach draft");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseCompanyDraftReviewPayload>;
  try { payload = parseCompanyDraftReviewPayload(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid draft review" }, { status: 400 }); }

  try {
    const db = getDb();
    const [draft] = await db.select().from(companyOutreachDrafts).where(eq(companyOutreachDrafts.id, payload.id)).limit(1);
    if (!draft || draft.state !== "draft") return Response.json({ error: "Reviewable company outreach draft not found" }, { status: 409 });
    const [latest] = await db.select().from(companyOutreachDraftRevisions)
      .where(eq(companyOutreachDraftRevisions.draftId, draft.id))
      .orderBy(desc(companyOutreachDraftRevisions.version)).limit(1);
    if (!latest || latest.id !== payload.revisionId) return Response.json({ error: "Draft revision is stale; reload and retry" }, { status: 409 });
    const now = new Date().toISOString();
    const [updated] = await db.update(companyOutreachDrafts).set(payload.action === "approve" ? {
      state: "approved",
      approvedRevisionId: latest.id,
      approvedAt: now,
      rejectedAt: null,
      updatedAt: now,
    } : {
      state: "rejected",
      approvedRevisionId: null,
      approvedAt: null,
      rejectedAt: now,
      updatedAt: now,
    }).where(and(eq(companyOutreachDrafts.id, draft.id), eq(companyOutreachDrafts.state, "draft"))).returning();
    if (!updated) return Response.json({ error: "Draft changed; reload and retry" }, { status: 409 });
    return Response.json({ draft: updated });
  } catch (error) {
    return scoutServerError("company-outreach.drafts.review", error, "Unable to review company outreach draft");
  }
}
