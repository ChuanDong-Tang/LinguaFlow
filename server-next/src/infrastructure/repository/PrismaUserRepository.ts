/** PrismaUserRepository：UserRepository 的 Prisma 实现。 */

import type {
  AuthProvider,
  BindAuthIdentityInput,
  CreateUserInput,
  EnsureUserExistsInput,
  UserAuthIdentity,
  UserEntity,
  UserRepository,
} from "@lf/core/ports/repository/UserRepository.js";

type PrismaUserClient = {
  user: {
    create: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
  };
  userAuthIdentity: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
  };
};

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaUserClient) {}

  async findByAuthIdentity(
    provider: AuthProvider,
    providerUserId: string
  ): Promise<UserEntity | null> {
    const identity = await this.prisma.userAuthIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: {
        user: true,
      },
    });

    if (!identity) {
      return null;
    }

    return this.toUserEntity(identity.user);
  }

  async create(input: CreateUserInput): Promise<UserEntity> {
    const created = await this.prisma.user.create({
      data: {
        nickname: input.nickname ?? null,
        avatarUrl: input.avatarUrl ?? null,
        status: "active",
      },
    });

    return this.toUserEntity(created);
  }

  async bindAuthIdentity(input: BindAuthIdentityInput): Promise<UserAuthIdentity> {
    const identity = await this.prisma.userAuthIdentity.upsert({
      where: {
        provider_providerUserId: {
          provider: input.provider,
          providerUserId: input.providerUserId,
        },
      },
      update: {
        userId: input.userId,
      },
      create: {
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
      },
    });

    return this.toUserAuthIdentity(identity);
  }

  async ensureUserExists(input: EnsureUserExistsInput): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: input.id },
      update: {
        nickname: input.nickname ?? undefined,
        avatarUrl: input.avatarUrl ?? undefined,
        status: input.status ?? undefined,
      },
      create: {
        id: input.id,
        nickname: input.nickname ?? null,
        avatarUrl: input.avatarUrl ?? null,
        status: input.status ?? "active",
      },
    });
  }

  async findById(userId: string): Promise<UserEntity | null> {
    const row = await this.prisma.user.findUnique({ where: { id: userId } });
    return row ? this.toUserEntity(row) : null;
  }


  private toUserEntity(record: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    status: "active" | "disabled";
    createdAt: Date;
    updatedAt: Date;
  }): UserEntity {
    return {
      id: record.id,
      nickname: record.nickname,
      avatarUrl: record.avatarUrl,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toUserAuthIdentity(record: {
    userId: string;
    provider: AuthProvider;
    providerUserId: string;
    createdAt: Date;
  }): UserAuthIdentity {
    return {
      userId: record.userId,
      provider: record.provider,
      providerUserId: record.providerUserId,
      createdAt: record.createdAt,
    };
  }

}

