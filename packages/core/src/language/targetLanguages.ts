export const TARGET_LANGUAGE_CODES = ["en-US", "ja-JP"] as const;

export type TargetLanguageCode = typeof TARGET_LANGUAGE_CODES[number];

export interface TargetLanguageProfile {
  code: TargetLanguageCode;
  name: string;
  matcher: {
    caseInsensitive: boolean;
    tokenBoundary: boolean;
    caseLocale?: string;
  };
  text: {
    compactLineBreaks: boolean;
    minSegmentChars: number;
    maxSegmentChars: number;
    primaryBoundary: RegExp;
    secondaryBoundary: RegExp;
    preferSpaceSplit: boolean;
  };
}

const TARGET_LANGUAGE_PROFILES: Record<TargetLanguageCode, TargetLanguageProfile> = {
  "en-US": {
    code: "en-US",
    name: "English",
    matcher: { caseInsensitive: true, tokenBoundary: true, caseLocale: "en-US" },
    text: {
      compactLineBreaks: false,
      minSegmentChars: 24,
      maxSegmentChars: 180,
      primaryBoundary: /[.!?;]+/g,
      secondaryBoundary: /[,，:：]/g,
      preferSpaceSplit: true,
    },
  },
  "ja-JP": {
    code: "ja-JP",
    name: "Japanese",
    matcher: { caseInsensitive: false, tokenBoundary: false },
    text: {
      compactLineBreaks: true,
      minSegmentChars: 12,
      maxSegmentChars: 120,
      primaryBoundary: /[。！？!?]+/g,
      secondaryBoundary: /[、，,]/g,
      preferSpaceSplit: false,
    },
  },
};

export function isTargetLanguageCode(value: unknown): value is TargetLanguageCode {
  return typeof value === "string" && Object.hasOwn(TARGET_LANGUAGE_PROFILES, value);
}

export function getTargetLanguageProfile(languageCode: string): TargetLanguageProfile {
  if (isTargetLanguageCode(languageCode)) return TARGET_LANGUAGE_PROFILES[languageCode];
  const error = new Error(`Unsupported target language: ${languageCode || "missing"}`) as Error & { code: string };
  error.code = "TARGET_LANGUAGE_UNSUPPORTED";
  throw error;
}

export function targetLanguageOrDefault(value?: string | null): TargetLanguageCode {
  return isTargetLanguageCode(value) ? value : "en-US";
}
