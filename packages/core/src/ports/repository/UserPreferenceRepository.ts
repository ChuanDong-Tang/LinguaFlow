export type AppLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
export type LearningLanguage = "en-US" | "ja-JP";
export type TtsProviderCode = "azure_global";
export type PromptDifficulty = "simple" | "native";
export type GuideState = Record<string, { completedAt?: string }>;

export interface UserPreferenceEntity {
  userId: string;
  appLocale: AppLocale;
  learningLanguage: LearningLanguage;
  promptDifficulty: PromptDifficulty;
  guideState: GuideState;
  ttsProvider: TtsProviderCode;
  ttsVoiceCode: string | null;
  sttMultilingualRecognitionEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateUserPreferenceInput {
  userId: string;
  appLocale?: AppLocale;
  learningLanguage?: LearningLanguage;
  promptDifficulty?: PromptDifficulty;
  guideState?: GuideState;
  ttsProvider?: TtsProviderCode;
  ttsVoiceCode?: string | null;
  sttMultilingualRecognitionEnabled?: boolean;
}

export interface UserPreferenceRepository {
  getByUserId(userId: string): Promise<UserPreferenceEntity>;
  upsert(input: UpdateUserPreferenceInput): Promise<UserPreferenceEntity>;
}
