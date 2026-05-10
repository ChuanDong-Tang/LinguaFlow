import type {
  TrustedCertEntity,
  TrustedCertRepository,
  UpsertTrustedCertInput,
} from "@lf/core/ports/repository/TrustedCertRepository.js";

type PrismaTrustedCertClient = {
  trustedCert: {
    upsert: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
};

export class PrismaTrustedCertRepository implements TrustedCertRepository {
  constructor(private readonly prisma: PrismaTrustedCertClient) {}

  async upsert(input: UpsertTrustedCertInput): Promise<TrustedCertEntity> {
    const row = await this.prisma.trustedCert.upsert({
      where: {
        provider_keyId_materialType: {
          provider: input.provider,
          keyId: input.keyId,
          materialType: input.materialType,
        },
      },
      update: {
        pem: input.pem,
        fingerprint: input.fingerprint ?? null,
        notBefore: input.notBefore ?? null,
        notAfter: input.notAfter ?? null,
        status: input.status ?? "active",
        metadata: input.metadata ?? null,
        lastSyncedAt: input.lastSyncedAt ?? new Date(),
      },
      create: {
        provider: input.provider,
        keyId: input.keyId,
        materialType: input.materialType,
        pem: input.pem,
        fingerprint: input.fingerprint ?? null,
        notBefore: input.notBefore ?? null,
        notAfter: input.notAfter ?? null,
        status: input.status ?? "active",
        metadata: input.metadata ?? null,
        lastSyncedAt: input.lastSyncedAt ?? new Date(),
      },
    });
    return this.toEntity(row);
  }

  async listActiveByProvider(provider: "wechat" | "apple"): Promise<TrustedCertEntity[]> {
    const rows = await this.prisma.trustedCert.findMany({
      where: {
        provider,
        status: "active",
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async deleteExpiredBefore(input: {
    provider?: "wechat" | "apple";
    before: Date;
  }): Promise<number> {
    const result = await this.prisma.trustedCert.deleteMany({
      where: {
        ...(input.provider ? { provider: input.provider } : {}),
        notAfter: { lt: input.before },
      },
    });
    return result.count;
  }

  private toEntity(row: any): TrustedCertEntity {
    return {
      id: row.id,
      provider: row.provider,
      keyId: row.keyId,
      materialType: row.materialType,
      pem: row.pem,
      fingerprint: row.fingerprint ?? null,
      notBefore: row.notBefore ?? null,
      notAfter: row.notAfter ?? null,
      status: row.status,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastSyncedAt: row.lastSyncedAt ?? null,
    };
  }
}
