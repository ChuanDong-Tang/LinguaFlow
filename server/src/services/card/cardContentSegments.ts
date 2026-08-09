import { createHash } from "node:crypto";
import type {
  CardContentSegmentWrite,
  CardLearningContentType,
} from "@lf/core/ports/repository/CardRepository.js";
import { segmentLearningSentences } from "@lf/core/text/learningText.js";

export type CardLearningContentInput = {
  contentType: CardLearningContentType;
  text: string | null;
  languageCode: string;
  sourceHash: string | null;
};

export function cardContentBlockVersion(input: Pick<CardLearningContentInput, "contentType" | "text" | "sourceHash">): string {
  const normalized = (input.text ?? "").normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
  return `sha256:${createHash("sha256")
    .update(`${input.contentType}\n${input.sourceHash ?? ""}\n${normalized}`)
    .digest("hex")}`;
}

export function buildCardContentSegments(inputs: CardLearningContentInput[]): CardContentSegmentWrite[] {
  return inputs.flatMap((input) => {
    const text = input.text?.trim();
    if (!text) return [];
    return [{
      contentType: input.contentType,
      contentVersion: cardContentBlockVersion({ ...input, text }),
      segments: segmentLearningSentences({
        text,
        languageCode: input.languageCode,
        minSegmentChars: 1,
        maxSegmentChars: 800,
      }).map((segment, ordinal) => ({
        ordinal,
        text: segment.text,
        startUtf16: segment.textStart,
        endUtf16: segment.textEnd,
      })),
    }];
  });
}
