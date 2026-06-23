export type AppLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
export type LearningLanguage = "en-US" | "ja-JP";
export type TtsProviderCode = "azure_global";

export interface UserPreferenceEntity {
  userId: string;
  appLocale: AppLocale;
  learningLanguage: LearningLanguage;
  ttsProvider: TtsProviderCode;
  ttsVoiceCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateUserPreferenceInput {
  userId: string;
  appLocale?: AppLocale;
  learningLanguage?: LearningLanguage;
  ttsProvider?: TtsProviderCode;
  ttsVoiceCode?: string | null;
}

export interface UserPreferenceRepository {
  getByUserId(userId: string): Promise<UserPreferenceEntity>;
  upsert(input: UpdateUserPreferenceInput): Promise<UserPreferenceEntity>;
}
