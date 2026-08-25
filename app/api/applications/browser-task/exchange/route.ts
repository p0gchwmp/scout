import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { applications, candidateClaims, jobs, profileEvidence } from "../../../../../db/schema";
import { buildAiApplicationAnswerEnvelope, type AiApplicationAnswer, type ApplicationQuestion } from "../../../../../lib/scout/ai-agent";
import { buildApplicationAnswerReview } from "../../../../../lib/scout/application-answer-review";
import { draftApplicationAnswersViaAgent } from "../../../../../lib/scout/application-answer-runtime";
import { verifyBrowserHandoffToken } from "../../../../../lib/scout/browser-handoff";
import { buildBrowserAssistTask } from "../../../../../lib/scout/browser-task";
import { analyzeFormFields, draftableApplicationQuestions, summarizeFormFields } from "../../../../../lib/scout/form-intelligence";

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
  const bindings = env as unknown as Record<string, unknown>;
  const secret = typeof bindings.SCOUT_BROWSER_HANDOFF_SECRET === "string" ? bindings.SCOUT_BROWSER_HANDOFF_SECRET.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Browser handoff is not configured");
  return secret;
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
    )).limit(1);
    if (!application) return json({ error: "The application packet changed or is no longer ready for review" }, 409);

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
        const claimIds = Array.isArray(packet.claimIds) ? packet.claimIds.filter((id): id is string => typeof id === "string").slice(0, 8) : [];
        const [job, claims, voiceRows] = await Promise.all([
          db.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1).then((rows) => rows[0]),
          claimIds.length ? db.select().from(candidateClaims).where(inArray(candidateClaims.id, claimIds)) : Promise.resolve([]),
          db.select().from(profileEvidence).where(eq(profileEvidence.verified, true)),
        ]);
        if (job?.currentSnapshotId && claims.length && claims.every((claim) => claim.status === "approved")) {
          const candidateName = voiceRows.find((field) => field.kind === "full_name")?.claim;
          if (candidateName) {
            const envelope = buildAiApplicationAnswerEnvelope({
              jobSnapshotId: job.currentSnapshotId,
              companyName: job.company,
              roleTitle: job.title,
              jobDescription: job.description.slice(0, 12_000),
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
          aiError = "Current snapshot and approved claim bindings are required before Scout can draft free-text answers";
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
        aiDraftAnswersRequireReview: answerReview.drafts.length > 0,
      },
      answerReview,
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
