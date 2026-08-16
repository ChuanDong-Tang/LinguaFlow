import type { TargetLanguageCode } from "@lf/core/language/targetLanguages.js";

type SpeechLanguageCode = TargetLanguageCode | "zh-CN" | "zh-TW";

export interface TtsVoiceOption {
  provider: string;
  languageCode: string;
  voiceCode: string;
  label: string;
  isDefault: boolean;
}

const AZURE_GLOBAL_PROVIDER = "azure_global";

const VOICES_BY_LANGUAGE: Record<SpeechLanguageCode, TtsVoiceOption[]> = {
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
  }, {
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "en-US",
    voiceCode: "en-GB-SoniaNeural",
    label: "Sonia (English UK)",
    isDefault: false,
  }, {
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "en-US",
    voiceCode: "en-GB-RyanNeural",
    label: "Ryan (English UK)",
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
  "zh-CN": [{
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "zh-CN",
    voiceCode: "zh-CN-XiaoxiaoNeural",
    label: "Xiaoxiao (简体中文)",
    isDefault: true,
  }],
  "zh-TW": [{
    provider: AZURE_GLOBAL_PROVIDER,
    languageCode: "zh-TW",
    voiceCode: "zh-TW-HsiaoChenNeural",
    label: "HsiaoChen (繁體中文)",
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
