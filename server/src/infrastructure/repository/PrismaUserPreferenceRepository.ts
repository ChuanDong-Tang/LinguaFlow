import type {
  AppLocale,
  LearningLanguage,
  TtsProviderCode,
  UpdateUserPreferenceInput,
  UserPreferenceEntity,
  UserPreferenceRepository,
} from "@lf/core/ports/repository/UserPreferenceRepository.js";

const DEFAULT_PREFERENCE: Pick<
  UserPreferenceEntity,
  "appLocale" | "learningLanguage" | "ttsProvider" | "ttsVoiceCode"
> = {
  appLocale: "zh-CN",
  learningLanguage: "en-US",
  ttsProvider: "azure_global",
  ttsVoiceCode: null,
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
        ttsProvider: input.ttsProvider ?? DEFAULT_PREFERENCE.ttsProvider,
        ttsVoiceCode: input.ttsVoiceCode ?? DEFAULT_PREFERENCE.ttsVoiceCode,
      },
      update: {
        ...(input.appLocale !== undefined ? { appLocale: input.appLocale } : {}),
        ...(input.learningLanguage !== undefined ? { learningLanguage: input.learningLanguage } : {}),
        ...(input.ttsProvider !== undefined ? { ttsProvider: input.ttsProvider } : {}),
        ...(input.ttsVoiceCode !== undefined ? { ttsVoiceCode: input.ttsVoiceCode } : {}),
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    userId: string;
    appLocale: string;
    learningLanguage: string;
    ttsProvider: string;
    ttsVoiceCode: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserPreferenceEntity {
    return {
      userId: row.userId,
      appLocale: normalizeAppLocale(row.appLocale),
      learningLanguage: normalizeLearningLanguage(row.learningLanguage),
      ttsProvider: normalizeTtsProvider(row.ttsProvider),
      ttsVoiceCode: row.ttsVoiceCode ?? null,
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
