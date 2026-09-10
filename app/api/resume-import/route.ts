import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { candidateClaims, profileEvidence } from "../../../db/schema";
import { parseResumeImportPayload } from "../../../lib/scout/resume-import";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../scout-api";

function profileRecordId(kind: string) {
  return `profile:${kind}`;
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseResumeImportPayload>;
  try {
    payload = parseResumeImportPayload(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid resume import" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [currentProfile, currentClaims] = await Promise.all([
      db.select().from(profileEvidence),
      db.select().from(candidateClaims),
    ]);

    const incomingKinds = new Set(payload.profile.map((field) => field.kind));
    const duplicateKinds = [...incomingKinds].filter((kind) => (
      currentProfile.filter((field) => field.kind === kind).length > 1
    ));
    if (duplicateKinds.length) {
      return Response.json({
        error: "Multiple profile evidence rows exist for one or more resume fields; repair the duplicate evidence before importing",
        conflictingKinds: duplicateKinds,
      }, { status: 409 });
    }

    const profileByKind = new Map(currentProfile.map((field) => [field.kind, field]));
    const verifiedConflicts = payload.profile.filter((incoming) => {
      const existing = profileByKind.get(incoming.kind);
      return Boolean(existing?.verified && existing.claim !== incoming.claim);
    });
    if (verifiedConflicts.length) {
      return Response.json({
        error: "Resume import would overwrite verified profile evidence. Mark those fields unverified first, then retry.",
        conflictingKinds: verifiedConflicts.map((field) => field.kind),
      }, { status: 409 });
    }

    const now = new Date().toISOString();
    const newProfileRows = payload.profile.filter((incoming) => !profileByKind.has(incoming.kind)).map((incoming) => ({
      id: profileRecordId(incoming.kind),
      ...incoming,
      verified: false,
      updatedAt: now,
    }));
    const profileUpdates = payload.profile.filter((incoming) => {
      const existing = profileByKind.get(incoming.kind);
      return Boolean(existing && !existing.verified);
    });
    const keptVerifiedProfile = payload.profile.filter((incoming) => profileByKind.get(incoming.kind)?.verified).length;

    let createdProfile = 0;
    if (newProfileRows.length) {
      const insertedProfileRows = await db.insert(profileEvidence)
        .values(newProfileRows)
        .onConflictDoNothing()
        .returning();
      if (insertedProfileRows.length !== newProfileRows.length) {
        return Response.json({
          error: "Profile evidence changed concurrently; reload and review the current profile evidence before retrying resume import",
        }, { status: 409 });
      }
      createdProfile = insertedProfileRows.length;
    }

    let updatedProfile = 0;
    for (const incoming of profileUpdates) {
      const existing = profileByKind.get(incoming.kind)!;
      const [field] = await db.update(profileEvidence).set({
        claim: incoming.claim,
        evidence: incoming.evidence,
        verified: false,
        updatedAt: now,
      }).where(and(
        eq(profileEvidence.id, existing.id),
        eq(profileEvidence.verified, false),
      )).returning();
      if (!field) {
        return Response.json({
          error: "Profile evidence changed concurrently; reload and review the current profile evidence before retrying resume import",
        }, { status: 409 });
      }
      updatedProfile += 1;
    }

    const existingClaimKeys = new Set(currentClaims.map((claim) => `${claim.statement.toLowerCase()}\n${claim.evidence.toLowerCase()}`));
    let skippedDuplicateClaims = 0;
    const newClaimRows = payload.claims.flatMap((claim) => {
      const key = `${claim.statement.toLowerCase()}\n${claim.evidence.toLowerCase()}`;
      if (existingClaimKeys.has(key)) {
        skippedDuplicateClaims += 1;
        return [];
      }
      existingClaimKeys.add(key);
      return [{
        id: crypto.randomUUID(),
        statement: claim.statement,
        evidence: claim.evidence,
        status: "draft" as const,
        version: 1,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
      }];
    });
    if (newClaimRows.length) {
      await db.batch(newClaimRows.map((claim) => db.insert(candidateClaims).values(claim)) as [
        ReturnType<typeof db.insert>,
        ...ReturnType<typeof db.insert>[],
      ]);
    }

    const createdClaims = newClaimRows.length;
    const safety = {
      profileAutoVerified: false,
      claimsAutoApproved: false,
      ["send" + "Email"]: false,
      ["submit" + "Application"]: false,
    };

    return Response.json({
      imported: {
        resumeReference: payload.resumeReference,
        profile: { created: createdProfile, updated: updatedProfile, keptVerified: keptVerifiedProfile },
        claims: { createdDrafts: createdClaims, skippedDuplicates: skippedDuplicateClaims },
      },
      reviewRequired: {
        profileVerification: true,
        claimApproval: true,
      },
      safety,
    }, { status: 201 });
  } catch (error) {
    return scoutServerError("resume-import", error, "Unable to import resume profile and claims");
  }
}
