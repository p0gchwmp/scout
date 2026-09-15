import { env } from "cloudflare:workers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { applications, candidateClaims, jobSnapshots, jobs, profileEvidence } from "../../../../../db/schema";
import { buildAiApplicationAnswerEnvelope, type AiApplicationAnswer, type ApplicationQuestion } from "../../../../../lib/scout/ai-agent";
import { buildApplicationAnswerReview } from "../../../../../lib/scout/application-answer-review";
import { draftApplicationAnswersViaAgent } from "../../../../../lib/scout/application-answer-runtime";
import { applicationPacketProfileBindingIssues } from "../../../../../lib/scout/application-profile-bindings";
import { applicationPacketMatchesCurrentSnapshot, applicationPacketSnapshotId } from "../../../../../lib/scout/application-review-packet";
import { verifyBrowserHandoffToken } from "../../../../../lib/scout/browser-handoff";
import { resolveBrowserHandoffSecret } from "../../../../../lib/scout/browser-handoff-runtime";
import { buildBrowserAssistTask } from "../../../../../lib/scout/browser-task";
import { analyzeFormFields, draftableApplicationQuestions, reviewApplicationFormConstraints, summarizeFormFields } from "../../../../../lib/scout/form-intelligence";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: corsHeaders });
}

function handoffSecret() {
  return resolveBrowserHandoffSecret(env as unknown as Record<string, unknown>);
}

function cleanQuestions(value: unknown): ApplicationQuestion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("Too many application questions");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Application question is invalid");
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const label = typeof record.label === "string" ? record.label.replace(/\s+/g, " ").trim() : "";
    if (!id || id.length > 200 || !label || label.length > 1000) throw new Error(`Application question ${index + 1} is invalid`);
    let maxLength: number | null = null;
    if (record.maxLength !== null && record.maxLength !== undefined) {
      const parsed = Number(record.maxLength);
      if (!Number.isInteger(parsed) || parsed < 40 || parsed > 5000) throw new Error("Application question maxLength is invalid");
      maxLength = parsed;
    }
    return { id, label, maxLength };
  });
}

function legacyQuestionFields(questions: ApplicationQuestion[]) {
  return questions.map((question) => ({
    id: question.id,
    label: question.label,
    controlKind: "textarea" as const,
    inputType: "textarea",
    maxLength: question.maxLength,
    required: false,
  }));
}

function payload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required");
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string" || record.token.length < 40 || record.token.length > 4000) throw new Error("Handoff token is invalid");
  if (typeof record.currentUrl !== "string" || record.currentUrl.length < 10 || record.currentUrl.length > 2000) throw new Error("Current application URL is invalid");
  if (Object.keys(record).some((key) => key !== "token" && key !== "currentUrl" && key !== "questions" && key !== "fields")) throw new Error("Unexpected browser handoff field");
  const questions = cleanQuestions(record.questions);
  const form = record.fields === undefined ? null : analyzeFormFields(record.fields);
  return { token: record.token, currentUrl: record.currentUrl, questions, form };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  let input: ReturnType<typeof payload>;
  try { input = payload(await request.json()); }
  catch { return json({ error: "A valid handoff token, application URL and bounded visible-field description are required" }, 400); }

  let verified: Awaited<ReturnType<typeof verifyBrowserHandoffToken>>;
  try {
    verified = await verifyBrowserHandoffToken({
      token: input.token,
      currentUrl: input.currentUrl,
      secret: handoffSecret(),
    });
  } catch {
    return json({ error: "Browser handoff was invalid, expired, or pinned to a different page" }, 401);
  }

  try {
    const db = getDb();
    const [application] = await db.select().from(applications).where(and(
      eq(applications.id, verified.applicationId),
      eq(applications.artifactVersion, verified.artifactVersion),
      eq(applications.status, "ready_for_review"),
      isNull(applications.submittedAt),
    )).limit(1);
    if (!application) return json({ error: "The application packet changed, was recorded as submitted, or is no longer ready for review" }, 409);

    const packetSnapshotId = applicationPacketSnapshotId(application.submittedFields);
    const [job, snapshot, currentProfileFields] = await Promise.all([
      db.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1).then((rows) => rows[0]),
      packetSnapshotId
        ? db.select().from(jobSnapshots).where(and(eq(jobSnapshots.id, packetSnapshotId), eq(jobSnapshots.jobId, application.jobId))).limit(1).then((rows) => rows[0])
        : Promise.resolve(undefined),
      db.select().from(profileEvidence),
    ]);
    if (!job?.currentSnapshotId || !packetSnapshotId || !snapshot || !applicationPacketMatchesCurrentSnapshot(application.submittedFields, job.currentSnapshotId)) {
      return json({ error: "The job snapshot changed after the browser handoff was minted; refresh the application packet and create a new handoff" }, 409);
    }
    const profileIssues = applicationPacketProfileBindingIssues(application.submittedFields, currentProfileFields);
    if (profileIssues.length) {
      return json({ error: "Verified profile evidence changed after the browser handoff was minted; refresh the application packet and create a new handoff", profileIssues }, 409);
    }

    const task = buildBrowserAssistTask({
      applicationId: application.id,
      artifactVersion: application.artifactVersion,
      packet: application.submittedFields,
    });
    if (task.allowedUrl !== verified.allowedUrl) return json({ error: "The application URL changed after the handoff was minted" }, 409);

    const observedForm = input.form ?? analyzeFormFields(legacyQuestionFields(input.questions));
    const verifiedProfileSources = new Set(task.answers
      .filter((answer) => answer.verified === true)
      .map((answer) => answer.sourceField));
    const resolvedFields = observedForm.fields.map((field) => (
      field.category === "safe_autofill" && field.sourceField && !verifiedProfileSources.has(field.sourceField)
        ? { ...field, category: "needs_user_answer" as const, sourceField: null, reason: "No verified reusable value is available for this field" }
        : field
    ));
    const form = { fields: resolvedFields, summary: summarizeFormFields(resolvedFields) };
    const constraintReview = reviewApplicationFormConstraints(form.fields);
    const draftableQuestions = draftableApplicationQuestions(form.fields);
    const manualQuestions = form.fields
      .filter((field) => field.category === "sensitive_manual" || field.category === "needs_user_answer" || field.category === "unsupported_manual")
      .map((field) => ({
        id: field.id,
        label: field.label,
        category: field.category,
        required: field.required,
        reason: field.reason,
      }));

    let aiAnswers: AiApplicationAnswer[] = [];
    let aiModel: string | null = null;
    let aiError: string | null = null;

    if (draftableQuestions.length) {
      try {
        const packet = application.submittedFields as unknown as { claimIds?: unknown };
        const claimIds = Array.isArray(packet.claimIds)
          ? [...new Set(packet.claimIds.filter((id): id is string => typeof id === "string" && id.trim()).map((id) => id.trim()).slice(0, 8))]
          : [];
        const claims = claimIds.length
          ? await db.select().from(candidateClaims).where(inArray(candidateClaims.id, claimIds))
          : [];
        const voiceRows = currentProfileFields.filter((field) => field.verified);
        const claimBindingsCurrent = claimIds.length > 0
          && claims.length === claimIds.length
          && claims.every((claim) => claim.status === "approved");
        if (claimBindingsCurrent) {
          const candidateName = voiceRows.find((field) => field.kind === "full_name")?.claim;
          if (candidateName) {
            const envelope = buildAiApplicationAnswerEnvelope({
              jobSnapshotId: snapshot.id,
              companyName: snapshot.company,
              roleTitle: snapshot.title,
              jobDescription: snapshot.description.slice(0, 12_000),
              candidateName,
              questions: draftableQuestions,
              claims: claims.map((claim) => ({ id: claim.id, statement: claim.statement, status: "approved" as const })),
              voice: {
                sample: voiceRows.find((field) => field.kind === "writing_sample")?.claim ?? null,
                styleNote: voiceRows.find((field) => field.kind === "writing_style_note")?.claim ?? null,
              },
            });
            const ai = await draftApplicationAnswersViaAgent(env as unknown as Record<string, unknown>, envelope);
            aiModel = ai.model || null;
            aiAnswers = ai.answers;
          } else {
            aiError = "Verified full_name is required before Scout can draft free-text answers";
          }
        } else {
          aiError = "Current approved claim bindings are required before Scout can draft free-text answers";
        }
      } catch {
        aiError = "AI free-text drafting was unavailable; verified autofill remains usable";
      }
    }

    const answerReview = buildApplicationAnswerReview({ questions: draftableQuestions, answers: aiAnswers });

    return json({
      task: {
        ...task,
        answers: task.answers,
        formIntelligence: { summary: form.summary },
        formConstraintReviewRequired: constraintReview.required,
        aiDraftAnswersRequireReview: answerReview.drafts.length > 0,
      },
      answerReview,
      constraintReview,
      formIntelligence: {
        summary: form.summary,
        fields: form.fields.map((field) => ({
          id: field.id,
          label: field.label,
          category: field.category,
          required: field.required,
          sourceField: field.sourceField,
          reason: field.reason,
        })),
      },
      ai: { model: aiModel, drafted: answerReview.drafts.length, error: aiError },
      manualQuestions,
      safety: {
        browserSentFieldValues: false,
        bearerTokenContainsProfileData: false,
        liveFormConstraintsUseMetadataOnly: true,
        liveFormConstraintsRequireHumanReview: constraintReview.required,
        sensitiveQuestionsRequireReview: true,
        unknownAnswersRequireUser: true,
        aiAnswersAreDrafts: true,
        aiAnswersRequireExplicitApprovalBeforeFill: true,
        solveCaptcha: false,
        submitApplication: false,
      },
    });
  } catch {
    return json({ error: "Unable to build the current browser assistance packet" }, 409);
  }
}
