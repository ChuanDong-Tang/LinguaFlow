export type DictionaryLookupCacheRow = {
  result: unknown;
  expiresAt: Date;
};

type PrismaDictionaryLookupCacheClient = {
  dictionaryLookupCache: {
    findUnique(args: unknown): Promise<DictionaryLookupCacheRow | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};

export class PrismaDictionaryLookupCacheRepository {
  constructor(private readonly prisma: PrismaDictionaryLookupCacheClient) {}

  find(cacheKey: string): Promise<DictionaryLookupCacheRow | null> {
    return this.prisma.dictionaryLookupCache.findUnique({
      where: { cacheKey },
      select: { result: true, expiresAt: true },
    });
  }

  async put(input: {
    cacheKey: string;
    userId: string;
    term: string;
    contextHash: string;
    targetLanguage: string;
    uiLanguage: string;
    promptVersion: string;
    provider: string;
    model: string;
    result: unknown;
    expiresAt: Date;
  }): Promise<void> {
    const data = { ...input };
    await this.prisma.dictionaryLookupCache.upsert({
      where: { cacheKey: input.cacheKey },
      create: data,
      update: {
        result: input.result,
        expiresAt: input.expiresAt,
        provider: input.provider,
        model: input.model,
      },
    });
  }
}
