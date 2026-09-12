import {
  generateCardContent,
  generateCardImageDescriptions,
  getCardRecord,
  CardApiError,
  type CardRecordDetail,
} from "../api/cardApi";

export type CardGenerationTarget = "expression" | "translation" | "auxiliary" | "reply" | "image_description";

export async function generateMissingCardContent(
  initialDetail: CardRecordDetail,
  targets: CardGenerationTarget[],
): Promise<{
  detail: CardRecordDetail;
  failedTargets: CardGenerationTarget[];
  generatedTargets: CardGenerationTarget[];
  resourceLimited: boolean;
}> {
  let detail = initialDetail;
  const failedTargets: CardGenerationTarget[] = [];
  const generatedTargets: CardGenerationTarget[] = [];
  let resourceLimited = false;

  const requestedTargets = [...new Set(targets)];
  const independentTargets = requestedTargets.filter((target) => target !== "auxiliary" && !hasGeneratedContent(detail, target));
  if (independentTargets.length === 1) {
    const target = independentTargets[0]!;
    try {
      detail = await generateTarget(detail, target);
      generatedTargets.push(target);
    } catch (error) {
      failedTargets.push(target);
      resourceLimited ||= isCardResourceLimitedError(error);
    }
  } else if (independentTargets.length > 1) {
    const results = await Promise.all(independentTargets.map(async (target) => {
      try {
        return { target, detail: await generateTarget(initialDetail, target), error: null };
      } catch (error) {
        return { target, detail: null, error };
      }
    }));
    for (const result of results) {
      if (result.detail) {
        detail = result.detail;
        generatedTargets.push(result.target);
      } else {
        failedTargets.push(result.target);
        resourceLimited ||= isCardResourceLimitedError(result.error);
      }
    }
    try {
      // Concurrent responses are snapshots taken at slightly different times.
      // Reload once so the caller receives the merged expression and image state.
      detail = await getCardRecord(initialDetail.id);
    } catch {
      // Keep the newest successful response; the regular detail refresh will reconcile it.
    }
  }

  if (requestedTargets.includes("auxiliary") && !hasGeneratedContent(detail, "auxiliary")) {
    if (resourceLimited) {
      failedTargets.push("auxiliary");
    } else {
      try {
        detail = await generateTarget(detail, "auxiliary");
        generatedTargets.push("auxiliary");
      } catch (error) {
        failedTargets.push("auxiliary");
        resourceLimited ||= isCardResourceLimitedError(error);
      }
    }
  }

  if (!failedTargets.length) return { detail, failedTargets, generatedTargets, resourceLimited };

  try {
    // The response can be lost after the server has committed a generation.
    // Reconcile before reporting a target as failed or offering a retry.
    detail = await getCardRecord(detail.id);
  } catch {
    return { detail, failedTargets, generatedTargets, resourceLimited };
  }

  return {
    detail,
    failedTargets: failedTargets.filter((target) => !hasGeneratedContent(detail, target)),
    generatedTargets: [
      ...new Set([
        ...generatedTargets,
        ...failedTargets.filter((target) => hasGeneratedContent(detail, target)),
      ]),
    ],
    resourceLimited,
  };
}

async function generateTarget(detail: CardRecordDetail, target: CardGenerationTarget): Promise<CardRecordDetail> {
  if (target === "image_description") return generateCardImageDescriptions(detail.id);
  if (target !== "auxiliary") return generateCardContent(detail.id, target);
  const sourceBlock = detail.contentBlocks.find((block) => block.contentType === "rewrite")
    ?? detail.contentBlocks.find((block) => block.contentType === "original")
    ?? detail.contentBlocks[0];
  if (!sourceBlock) throw new Error("No content is available for auxiliary generation");
  return generateCardContent(detail.id, target, sourceBlock.contentType);
}

export function isCardResourceLimitedError(error: unknown): boolean {
  return error instanceof CardApiError && (
    error.status === 429
    || error.code === "RATE_LIMITED"
    || error.code === "RESOURCE_LIMITED"
    || error.code === "TASK_IN_PROGRESS"
  );
}

export function hasGeneratedContent(detail: CardRecordDetail, target: CardGenerationTarget): boolean {
  if (target === "expression") return Boolean(detail.rewrittenText?.trim());
  if (target === "translation") return Boolean(detail.translationText?.trim());
  if (target === "auxiliary") return Boolean(
    detail.auxiliarySegments?.length
    || detail.contentBlocks.some((block) => block.auxiliarySegments?.length),
  );
  if (target === "image_description") return Boolean(detail.images?.length)
    && detail.images!.every((image) => image.descriptionStatus === "completed" && Boolean(image.descriptionText?.trim()));
  return Boolean(detail.replyText?.trim());
}
