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
): Promise<{ detail: CardRecordDetail; failedTargets: CardGenerationTarget[]; resourceLimited: boolean }> {
  let detail = initialDetail;
  const failedTargets: CardGenerationTarget[] = [];
  let resourceLimited = false;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (hasGeneratedContent(detail, target)) continue;
    try {
      detail = target === "image_description"
        ? await generateCardImageDescriptions(detail.id)
        : await generateCardContent(detail.id, target);
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

  if (!failedTargets.length) return { detail, failedTargets, resourceLimited };

  try {
    // The response can be lost after the server has committed a generation.
    // Reconcile before reporting a target as failed or offering a retry.
    detail = await getCardRecord(detail.id);
  } catch {
    return { detail, failedTargets, resourceLimited };
  }

  return {
    detail,
    failedTargets: failedTargets.filter((target) => !hasGeneratedContent(detail, target)),
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
  if (target === "auxiliary") return Boolean(detail.auxiliarySegments?.length);
  if (target === "image_description") return Boolean(detail.images?.length)
    && detail.images!.every((image) => image.descriptionStatus === "completed" && Boolean(image.descriptionText?.trim()));
  return Boolean(detail.replyText?.trim());
}
