import type { CardLearningContentType, CardRecordDetail } from "../api/cardApi";

export type CardGenerationTarget = "expression" | "translation" | "auxiliary" | "reply" | "image_description";

export type CardGenerationDependencies = {
  generateContent: (
    recordId: string,
    target: Exclude<CardGenerationTarget, "image_description">,
    contentType?: CardLearningContentType,
  ) => Promise<CardRecordDetail>;
  generateImageDescriptions: (recordId: string) => Promise<CardRecordDetail>;
  getRecord: (recordId: string) => Promise<CardRecordDetail>;
};

export type CardGenerationRules = {
  hasGeneratedContent: (detail: CardRecordDetail, target: CardGenerationTarget) => boolean;
  isResourceLimitedError: (error: unknown) => boolean;
};

export async function coordinateMissingCardContent(
  initialDetail: CardRecordDetail,
  targets: CardGenerationTarget[],
  dependencies: CardGenerationDependencies,
  rules: CardGenerationRules,
): Promise<{
  detail: CardRecordDetail;
  failedTargets: CardGenerationTarget[];
  generatedTargets: CardGenerationTarget[];
  resourceLimited: boolean;
}> {
  const requestedTargets = [...new Set(targets)];
  const independentTargets = requestedTargets.filter((target) => (
    target !== "auxiliary" && !rules.hasGeneratedContent(initialDetail, target)
  ));
  const wantsAuxiliary = requestedTargets.includes("auxiliary")
    && !rules.hasGeneratedContent(initialDetail, "auxiliary");
  const expressionRequested = independentTargets.includes("expression");
  const tasks: Array<Promise<GenerationAttempt[]>> = [];

  const attempt = async (detail: CardRecordDetail, target: CardGenerationTarget): Promise<GenerationAttempt> => {
    try {
      return {
        target,
        detail: await generateTarget(detail, target, dependencies),
        error: null,
        completedAt: Date.now(),
      };
    } catch (error) {
      return { target, detail: null, error, completedAt: Date.now() };
    }
  };

  if (expressionRequested) {
    tasks.push((async () => {
      const expression = await attempt(initialDetail, "expression");
      if (!wantsAuxiliary) return [expression];
      if (!expression.detail) {
        return [expression, {
          target: "auxiliary",
          detail: null,
          error: null,
          completedAt: expression.completedAt,
          dependencyFailed: true,
        }];
      }
      return [expression, await attempt(expression.detail, "auxiliary")];
    })());
  }

  for (const target of independentTargets.filter((target) => target !== "expression")) {
    tasks.push(attempt(initialDetail, target).then((result) => [result]));
  }

  if (wantsAuxiliary && !expressionRequested) {
    tasks.push(attempt(initialDetail, "auxiliary").then((result) => [result]));
  }

  if (!tasks.length) {
    return { detail: initialDetail, failedTargets: [], generatedTargets: [], resourceLimited: false };
  }

  const attempts = (await Promise.all(tasks)).flat();
  const successfulAttempts = attempts.filter(
    (attemptResult): attemptResult is GenerationAttempt & { detail: CardRecordDetail } => Boolean(attemptResult.detail),
  );
  const newestSuccessful = successfulAttempts
    .slice()
    .sort((left, right) => right.completedAt - left.completedAt)[0];
  let detail = newestSuccessful?.detail ?? initialDetail;

  try {
    // Concurrent responses are snapshots taken at different times. Reload once
    // so the caller sees every successful branch before retry state is derived.
    detail = await dependencies.getRecord(initialDetail.id);
  } catch {
    // Keep the latest successful snapshot; the regular detail refresh will reconcile it.
  }

  const failedAttempts = attempts.filter((attemptResult) => !attemptResult.detail);
  const failedTargets = failedAttempts
    .map((attemptResult) => attemptResult.target)
    .filter((target) => !rules.hasGeneratedContent(detail, target));
  const generatedTargets = [
    ...new Set([
      ...successfulAttempts.map((attemptResult) => attemptResult.target),
      ...failedAttempts
        .map((attemptResult) => attemptResult.target)
        .filter((target) => rules.hasGeneratedContent(detail, target)),
    ]),
  ];

  return {
    detail,
    failedTargets: [...new Set(failedTargets)],
    generatedTargets,
    resourceLimited: failedAttempts.some((attemptResult) => (
      !attemptResult.dependencyFailed && rules.isResourceLimitedError(attemptResult.error)
    )),
  };
}

type GenerationAttempt = {
  target: CardGenerationTarget;
  detail: CardRecordDetail | null;
  error: unknown;
  completedAt: number;
  dependencyFailed?: boolean;
};

async function generateTarget(
  detail: CardRecordDetail,
  target: CardGenerationTarget,
  dependencies: CardGenerationDependencies,
): Promise<CardRecordDetail> {
  if (target === "image_description") return dependencies.generateImageDescriptions(detail.id);
  if (target !== "auxiliary") return dependencies.generateContent(detail.id, target);
  const sourceBlock = detail.contentBlocks.find((block) => block.contentType === "rewrite")
    ?? detail.contentBlocks.find((block) => block.contentType === "original")
    ?? detail.contentBlocks[0];
  if (!sourceBlock) throw new Error("No content is available for auxiliary generation");
  return dependencies.generateContent(detail.id, target, sourceBlock.contentType);
}
