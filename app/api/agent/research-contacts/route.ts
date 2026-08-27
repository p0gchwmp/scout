import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companySources, contactEvidence, jobSnapshots, jobs } from "../../../../db/schema";
import { parseContactExtractionPayload } from "../../../../lib/scout/api-validation";
import { createScoutAgentClientFromBindings } from "../../../../lib/scout/agent-runtime";
import { assessPublishedContact, rankPublishedContacts } from "../../../../lib/scout/contact-intelligence";
import { requireSameOriginMutation, requireScoutApiUser, scoutServerError } from "../../../scout-api";

function unresolvedDomain(value: string | null | undefined) {
  return !value || value.endsWith(".invalid");
}

export async function POST(request: Request) {
  const unauthorized = await requireScoutApiUser();
  if (unauthorized) return unauthorized;
  const crossOrigin = requireSameOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  let payload: ReturnType<typeof parseContactExtractionPayload>;
  try { payload = parseContactExtractionPayload(await request.json()); }
  catch { return Response.json({ error: "A valid job id is required" }, { status: 400 }); }

  try {
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, payload.jobId)).limit(1);
    if (!job?.currentSnapshotId || !job.sourceRegistryId) {
      return Response.json({ error: "An official synced job snapshot is required before contact research" }, { status: 409 });
    }
    const [snapshot] = await db.select().from(jobSnapshots)
      .where(and(eq(jobSnapshots.id, job.currentSnapshotId), eq(jobSnapshots.jobId, job.id))).limit(1);
    const [source] = await db.select().from(companySources).where(eq(companySources.id, job.sourceRegistryId)).limit(1);
    if (!snapshot || !source?.enabled || unresolvedDomain(source.companyDomain)) {
      return Response.json({ error: "A verified official company domain is required before contact research" }, { status: 409 });
    }

    const client = createScoutAgentClientFromBindings(env as unknown as Record<string, unknown>);
    const researchInput = {
      companyDomain: source.companyDomain,
      jobSnapshotId: snapshot.id,
      careersUrl: source.careersUrl,
    };
    const research = await client.researchContacts(researchInput);

    if (research.candidates.length) {
      await db.batch(research.candidates.map((candidate) => {
        const intelligence = assessPublishedContact(candidate);
        return db.insert(contactEvidence).values({
          id: crypto.randomUUID(),
          jobId: job.id,
          jobSnapshotId: snapshot.id,
          email: candidate.email,
          sourceUrl: candidate.sourceUrl,
          excerpt: candidate.excerpt,
          sourceType: candidate.sourceType,
          extractedAt: research.researchedAt,
          suitability: intelligence.signal === "recruiting" ? "high" : "review",
          suitabilityReason: `Deterministic contact intelligence ${intelligence.score}/100: ${intelligence.reasons.join("; ")}. Human review is still required.`,
          reviewState: "needs_review",
        }).onConflictDoNothing();
      }) as [ReturnType<typeof db.insert>, ...ReturnType<typeof db.insert>[]]);
    }

    const storedContacts = await db.select().from(contactEvidence)
      .where(eq(contactEvidence.jobSnapshotId, snapshot.id));
    const contacts = rankPublishedContacts(storedContacts);

    return Response.json({
      jobId: job.id,
      jobSnapshotId: snapshot.id,
      companyDomain: source.companyDomain,
      pagesAttempted: research.pagesAttempted,
      failures: research.failures,
      candidatesFound: research.candidates.length,
      contacts,
      safety: { linkedinScrape: false, guessedEmails: false, autoAcceptContact: false, sendEmail: false },
    });
  } catch (error) {
    return scoutServerError("agent.research-contacts", error, "Cloud agent contact research failed");
  }
}
