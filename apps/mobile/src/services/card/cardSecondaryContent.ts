type SecondarySegment = { ordinal: number; text: string };

type SecondaryContentBlock = {
  contentType: string;
  auxiliarySegments?: SecondarySegment[] | null;
  auxiliaryLanguageCode?: string | null;
  alignedOriginalSegments?: SecondarySegment[] | null;
  alignedOriginalLanguageCode?: string | null;
};

export function resolveCardSecondaryContent(block: SecondaryContentBlock, isSample = false) {
  // Tutorial cards have translations but no user-authored original to align.
  const useOriginal = block.contentType === "rewrite" && !isSample;
  return {
    segments: (useOriginal ? block.alignedOriginalSegments : block.auxiliarySegments) ?? [],
    languageCode: (useOriginal ? block.alignedOriginalLanguageCode : block.auxiliaryLanguageCode) ?? null,
  };
}
