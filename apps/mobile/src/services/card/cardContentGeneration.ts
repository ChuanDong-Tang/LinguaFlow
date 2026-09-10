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

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (hasGeneratedContent(detail, target)) continue;
    try {
      if (target === "image_description") {
        detail = await generateCardImageDescriptions(detail.id);
      } else if (target === "auxiliary") {
        const sourceBlock = detail.contentBlocks.find((block) => block.contentType === "rewrite")
          ?? detail.contentBlocks.find((block) => block.contentType === "original")
          ?? detail.contentBlocks[0];
        if (!sourceBlock) throw new Error("No content is available for auxiliary generation");
        detail = await generateCardContent(detail.id, target, sourceBlock.contentType);
      } else {
        detail = await generateCardContent(detail.id, target);
      }
      generatedTargets.push(target);
    } catch (error) {
      failedTargets.push(target);
      const limited = isCardResourceLimitedError(error);
      resourceLimited ||= limited;
      if (limited) {
        failedTargets.push(...targets.slice(index + 1).filter((remaining) => !hasGeneratedContent(detail, remaining)));
        break;
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
