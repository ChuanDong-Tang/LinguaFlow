import type {
  CreateUserSessionInput,
  RotateUserSessionInput,
  UpdateUserSessionInput,
  UserSessionEntity,
  UserSessionRepository,
} from "@lf/core/ports/repository/UserSessionRepository.js";

type PrismaUserSessionClient = {
  $transaction?: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
  userSession: {
    create: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
};

export class PrismaUserSessionRepository implements UserSessionRepository {
  constructor(private readonly prisma: PrismaUserSessionClient) {}

  async create(input: CreateUserSessionInput): Promise<UserSessionEntity> {
    const row = await this.prisma.userSession.create({
      data: {
        id: input.id,
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
        expiresAt: input.expiresAt,
      },
    });

    return this.toEntity(row);
  }

  async findById(id: string): Promise<UserSessionEntity | null> {
    const row = await this.prisma.userSession.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
  }

  async update(input: UpdateUserSessionInput): Promise<UserSessionEntity> {
    const row = await this.prisma.userSession.update({
      where: { id: input.id },
      data: {
        refreshTokenHash: input.refreshTokenHash ?? undefined,
        expiresAt: input.expiresAt ?? undefined,
        revokedAt: input.revokedAt === undefined ? undefined : input.revokedAt,
        replacedBySessionId:
          input.replacedBySessionId === undefined ? undefined : input.replacedBySessionId,
        lastUsedAt: input.lastUsedAt === undefined ? undefined : input.lastUsedAt,
        userAgent: input.userAgent === undefined ? undefined : input.userAgent,
        ip: input.ip === undefined ? undefined : input.ip,
      },
    });

    return this.toEntity(row);
  }

  async rotateSession(input: RotateUserSessionInput): Promise<void> {
    if (!this.prisma.$transaction) {
      throw new Error("Prisma transaction client is required for rotateSession");
    }
    await this.prisma.$transaction(async (tx: any) => {
      await tx.userSession.update({
        where: { id: input.currentSessionId },
        data: {
          revokedAt: input.revokedAt,
          replacedBySessionId: input.replacedBySessionId,
          lastUsedAt: input.lastUsedAt,
        },
      });
      await tx.userSession.create({
        data: {
          id: input.nextSession.id,
          userId: input.nextSession.userId,
          refreshTokenHash: input.nextSession.refreshTokenHash,
          userAgent: input.nextSession.userAgent ?? null,
          ip: input.nextSession.ip ?? null,
          expiresAt: input.nextSession.expiresAt,
        },
      });
    });
  }

  async listActiveByUserId(userId: string): Promise<UserSessionEntity[]> {
    const rows = await this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: "desc" },
    });

    return rows.map((row) => this.toEntity(row));
  }

  async revokeAllByUserId(userId: string, revokedAt: Date): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt,
      },
    });

    return result.count;
  }

  private toEntity(row: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    userAgent: string | null;
    ip: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
    replacedBySessionId: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserSessionEntity {
    return {
      id: row.id,
      userId: row.userId,
      refreshTokenHash: row.refreshTokenHash,
      userAgent: row.userAgent,
      ip: row.ip,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      replacedBySessionId: row.replacedBySessionId,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
