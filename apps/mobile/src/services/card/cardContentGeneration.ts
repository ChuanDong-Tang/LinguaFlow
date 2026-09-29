import {
  generateCardContent,
  generateCardImageDescriptions,
  getCardRecord,
  CardApiError,
  type CardRecordDetail,
} from "../api/cardApi";
import {
  coordinateMissingCardContent,
  type CardGenerationDependencies,
  type CardGenerationTarget,
} from "./cardContentGenerationCoordinator";

export type { CardGenerationDependencies, CardGenerationTarget } from "./cardContentGenerationCoordinator";

const defaultDependencies: CardGenerationDependencies = {
  generateContent: generateCardContent,
  generateImageDescriptions: generateCardImageDescriptions,
  getRecord: getCardRecord,
};

export async function generateMissingCardContent(
  initialDetail: CardRecordDetail,
  targets: CardGenerationTarget[],
  dependencies: CardGenerationDependencies = defaultDependencies,
): Promise<{
  detail: CardRecordDetail;
  failedTargets: CardGenerationTarget[];
  generatedTargets: CardGenerationTarget[];
  resourceLimited: boolean;
}> {
  return coordinateMissingCardContent(initialDetail, targets, dependencies, {
    hasGeneratedContent,
    isResourceLimitedError: isCardResourceLimitedError,
  });
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
