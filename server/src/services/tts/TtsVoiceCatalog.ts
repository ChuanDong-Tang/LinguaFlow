import type { TargetLanguageCode } from "@lf/core/language/targetLanguages.js";

export interface TtsVoiceOption {
  provider: string;
  languageCode: string;
  voiceCode: string;
  label: string;
  isDefault: boolean;
}

const AZURE_GLOBAL_PROVIDER = "azure_global";

const VOICES_BY_LANGUAGE: Record<TargetLanguageCode, TtsVoiceOption[]> = {
  "en-US": [{
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "en-US",
    voiceCode: "en-US-AvaMultilingualNeural",
    label: "Ava (English US)",
    isDefault: true,
  }, {
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "en-US",
    voiceCode: "en-US-AndrewMultilingualNeural",
    label: "Andrew (English US)",
    isDefault: false,
  }],
  "ja-JP": [{
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "ja-JP",
    voiceCode: "ja-JP-KeitaNeural",
    label: "Keita (Japanese)",
    isDefault: false,
  }, {
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "ja-JP",
    voiceCode: "ja-JP-MayuNeural",
    label: "Mayu (Japanese)",
    isDefault: true,
  }],
};

const VOICES: TtsVoiceOption[] = Object.values(VOICES_BY_LANGUAGE).flat();

export function listTtsVoiceOptions(input: {
  provider?: string;
  languageCode?: string;
} = {}): TtsVoiceOption[] {
  return VOICES.filter((voice) =>
    (!input.provider || voice.provider === input.provider) &&
    (!input.languageCode || voice.languageCode === input.languageCode)
  );
}

export function resolveDefaultTtsVoice(languageCode: string, provider = AZURE_GLOBAL_PROVIDER): string {
  return (
    VOICES.find((voice) => voice.provider === provider && voice.languageCode === languageCode && voice.isDefault)
      ?.voiceCode ??
    VOICES.find((voice) => voice.provider === provider && voice.isDefault)?.voiceCode ??
    "en-US-JennyNeural"
  );
}

export function isConfiguredTtsVoice(input: {
  provider: string;
  languageCode: string;
  voiceCode: string;
}): boolean {
  return VOICES.some((voice) =>
    voice.provider === input.provider &&
    voice.languageCode === input.languageCode &&
    voice.voiceCode === input.voiceCode
  );
}
