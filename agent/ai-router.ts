import type {
  AiApplicationAnswer,
  AiApplicationAnswerEnvelope,
  AiContactClassification,
  AiOutreachEnvelope,
  AiOutreachResult,
  PublishedContactCandidate,
} from "../lib/scout/ai-agent.ts";

export type ScoutAiWorker = {
  classifyPublishedContacts(candidates: PublishedContactCandidate[]): Promise<AiContactClassification[]>;
  draftOutreach(envelope: AiOutreachEnvelope): Promise<AiOutreachResult>;
  draftApplicationAnswers(envelope: AiApplicationAnswerEnvelope): Promise<AiApplicationAnswer[]>;
};

export type RoutedAiCandidate = {
  id: string;
  worker: ScoutAiWorker;
};

export type ScoutAiRoutePlan = {
  classification: readonly RoutedAiCandidate[];
  writing: readonly RoutedAiCandidate[];
};

export class AiRouteExhaustedError extends Error {
  readonly attemptedProviderIds: readonly string[];

  constructor(task: "classification" | "writing", attemptedProviderIds: readonly string[]) {
    super(`All configured free/included Scout AI providers failed for ${task}`);
    this.name = "AiRouteExhaustedError";
    this.attemptedProviderIds = attemptedProviderIds;
  }
}

async function firstValid<T>(
  task: "classification" | "writing",
  candidates: readonly RoutedAiCandidate[],
  run: (worker: ScoutAiWorker) => Promise<T>,
): Promise<T> {
  const attempted: string[] = [];
  for (const candidate of candidates) {
    attempted.push(candidate.id);
    try {
      return await run(candidate.worker);
    } catch {
      // Provider/network/quota/schema failures are deliberately isolated here.
      // Scout tries the next pre-approved free/included candidate and never
      // changes factual/evidence safety boundaries to make a model succeed.
    }
  }
  throw new AiRouteExhaustedError(task, attempted);
}

export function createQualityAiRouter(plan: ScoutAiRoutePlan) {
  if (!plan.classification.length || !plan.writing.length) {
    throw new Error("Scout AI router requires at least one configured candidate for every route");
  }

  const routePlan = Object.freeze({
    classification: Object.freeze(plan.classification.map((candidate) => candidate.id)),
    writing: Object.freeze(plan.writing.map((candidate) => candidate.id)),
  });

  return Object.freeze({
    routePlan,
    async classifyPublishedContacts(candidates: PublishedContactCandidate[]) {
      return firstValid("classification", plan.classification, (worker) => worker.classifyPublishedContacts(candidates));
    },
    async draftOutreach(envelope: AiOutreachEnvelope) {
      return firstValid("writing", plan.writing, (worker) => worker.draftOutreach(envelope));
    },
    async draftApplicationAnswers(envelope: AiApplicationAnswerEnvelope) {
      return firstValid("writing", plan.writing, (worker) => worker.draftApplicationAnswers(envelope));
    },
  });
}
