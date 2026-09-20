import type { TargetLanguageCode } from "../../language/targetLanguages.js";

export type AppLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
export type LearningLanguage = TargetLanguageCode;
export type TtsProviderCode = "azure_global";
export type PromptDifficulty = "simple" | "native";
export type AutoClozeFrequency = "high" | "medium" | "low";
export const ACQUISITION_SOURCES = ["youtube", "xiaohongshu", "douyin", "app_store", "google_play"] as const;
export type AcquisitionSource = typeof ACQUISITION_SOURCES[number];
export type GuideState = Record<string, { completedAt?: string }>;

export function isAcquisitionSource(value: unknown): value is AcquisitionSource {
  return typeof value === "string" && (ACQUISITION_SOURCES as readonly string[]).includes(value);
}

export interface UserPreferenceEntity {
  userId: string;
  appLocale: AppLocale;
  learningLanguage: LearningLanguage;
  promptDifficulty: PromptDifficulty;
  acquisitionSource: AcquisitionSource | null;
  guideState: GuideState;
  ttsProvider: TtsProviderCode;
  ttsVoiceCode: string | null;
  sttMultilingualRecognitionEnabled: boolean;
  autoClozeEnabled: boolean;
  autoClozeFrequency: AutoClozeFrequency;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateUserPreferenceInput {
  userId: string;
  appLocale?: AppLocale;
  learningLanguage?: LearningLanguage;
  promptDifficulty?: PromptDifficulty;
  acquisitionSource?: AcquisitionSource;
  guideState?: GuideState;
  ttsProvider?: TtsProviderCode;
  ttsVoiceCode?: string | null;
  sttMultilingualRecognitionEnabled?: boolean;
  autoClozeEnabled?: boolean;
  autoClozeFrequency?: AutoClozeFrequency;
}

export interface UserPreferenceRepository {
  getByUserId(userId: string): Promise<UserPreferenceEntity>;
  upsert(input: UpdateUserPreferenceInput): Promise<UserPreferenceEntity>;
}
