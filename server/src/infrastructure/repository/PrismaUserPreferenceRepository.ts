import type {
  AppLocale,
  GuideState,
  LearningLanguage,
  PromptDifficulty,
  TtsProviderCode,
  UpdateUserPreferenceInput,
  UserPreferenceEntity,
  UserPreferenceRepository,
} from "@lf/core/ports/repository/UserPreferenceRepository.js";

const DEFAULT_PREFERENCE: Pick<
  UserPreferenceEntity,
  | "appLocale"
  | "learningLanguage"
  | "promptDifficulty"
  | "guideState"
  | "ttsProvider"
  | "ttsVoiceCode"
  | "sttMultilingualRecognitionEnabled"
> = {
  appLocale: "zh-CN",
  learningLanguage: "en-US",
  promptDifficulty: "native",
  guideState: {},
  ttsProvider: "azure_global",
  ttsVoiceCode: null,
  sttMultilingualRecognitionEnabled: false,
};

type PrismaUserPreferenceClient = {
  userPreference: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
  };
};

export class PrismaUserPreferenceRepository implements UserPreferenceRepository {
  constructor(private readonly prisma: PrismaUserPreferenceClient) {}

  async getByUserId(userId: string): Promise<UserPreferenceEntity> {
    const row = await this.prisma.userPreference.findUnique({
      where: { userId },
    });
    if (row) return this.toEntity(row);

    const now = new Date();
    return {
      userId,
      ...DEFAULT_PREFERENCE,
      createdAt: now,
      updatedAt: now,
    };
  }

  async upsert(input: UpdateUserPreferenceInput): Promise<UserPreferenceEntity> {
    const row = await this.prisma.userPreference.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        appLocale: input.appLocale ?? DEFAULT_PREFERENCE.appLocale,
        learningLanguage: input.learningLanguage ?? DEFAULT_PREFERENCE.learningLanguage,
        promptDifficulty: input.promptDifficulty ?? DEFAULT_PREFERENCE.promptDifficulty,
        guideState: input.guideState ?? DEFAULT_PREFERENCE.guideState,
        ttsProvider: input.ttsProvider ?? DEFAULT_PREFERENCE.ttsProvider,
        ttsVoiceCode: input.ttsVoiceCode ?? DEFAULT_PREFERENCE.ttsVoiceCode,
        sttMultilingualRecognitionEnabled:
          input.sttMultilingualRecognitionEnabled ?? DEFAULT_PREFERENCE.sttMultilingualRecognitionEnabled,
      },
      update: {
        ...(input.appLocale !== undefined ? { appLocale: input.appLocale } : {}),
        ...(input.learningLanguage !== undefined ? { learningLanguage: input.learningLanguage } : {}),
        ...(input.promptDifficulty !== undefined ? { promptDifficulty: input.promptDifficulty } : {}),
        ...(input.guideState !== undefined ? { guideState: input.guideState } : {}),
        ...(input.ttsProvider !== undefined ? { ttsProvider: input.ttsProvider } : {}),
        ...(input.ttsVoiceCode !== undefined ? { ttsVoiceCode: input.ttsVoiceCode } : {}),
        ...(input.sttMultilingualRecognitionEnabled !== undefined
          ? { sttMultilingualRecognitionEnabled: input.sttMultilingualRecognitionEnabled }
          : {}),
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    userId: string;
    appLocale: string;
    learningLanguage: string;
    promptDifficulty?: string | null;
    guideState?: unknown;
    ttsProvider: string;
    ttsVoiceCode: string | null;
    sttMultilingualRecognitionEnabled?: boolean | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserPreferenceEntity {
    return {
      userId: row.userId,
      appLocale: normalizeAppLocale(row.appLocale),
      learningLanguage: normalizeLearningLanguage(row.learningLanguage),
      promptDifficulty: normalizePromptDifficulty(row.promptDifficulty),
      guideState: normalizeGuideState(row.guideState),
      ttsProvider: normalizeTtsProvider(row.ttsProvider),
      ttsVoiceCode: row.ttsVoiceCode ?? null,
      sttMultilingualRecognitionEnabled: row.sttMultilingualRecognitionEnabled === true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function normalizeAppLocale(value: string): AppLocale {
  return value === "zh-TW" || value === "en-US" || value === "ja-JP" ? value : "zh-CN";
}

function normalizeLearningLanguage(value: string): LearningLanguage {
  return value === "ja-JP" ? "ja-JP" : "en-US";
}

function normalizeTtsProvider(value: string): TtsProviderCode {
  return value === "azure_global" ? "azure_global" : "azure_global";
}

function normalizePromptDifficulty(value: string | null | undefined): PromptDifficulty {
  return value === "simple" ? "simple" : "native";
}

function normalizeGuideState(value: unknown): GuideState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: GuideState = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const completedAt = (entry as Record<string, unknown>).completedAt;
    output[key] = typeof completedAt === "string" ? { completedAt } : {};
  }
  return output;
}
