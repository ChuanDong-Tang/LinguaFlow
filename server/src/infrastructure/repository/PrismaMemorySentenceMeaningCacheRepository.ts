export type MemorySentenceMeaningCacheRow = { meaning: string };

type PrismaMemorySentenceMeaningCacheClient = {
  memorySentenceMeaningCache: {
    findUnique(args: unknown): Promise<MemorySentenceMeaningCacheRow | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};

export class PrismaMemorySentenceMeaningCacheRepository {
  constructor(private readonly prisma: PrismaMemorySentenceMeaningCacheClient) {}

  find(cacheKey: string): Promise<MemorySentenceMeaningCacheRow | null> {
    return this.prisma.memorySentenceMeaningCache.findUnique({ where: { cacheKey }, select: { meaning: true } });
  }

  async put(input: {
    cacheKey: string;
    userId: string;
    sentenceHash: string;
    sourceLanguage: string;
    nativeLanguage: string;
    promptVersion: string;
    provider: string;
    model: string;
    meaning: string;
  }): Promise<void> {
    await this.prisma.memorySentenceMeaningCache.upsert({
      where: { cacheKey: input.cacheKey },
      create: input,
      update: { meaning: input.meaning, provider: input.provider, model: input.model },
    });
  }
}
