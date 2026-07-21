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
import { generateDefaultProfileNickname } from "../../services/auth/profileNickname.js";

type PrismaUserClient = {
  user: {
    create: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  userAuthIdentity: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
  userProfile: {
    upsert: (args: any) => Promise<any>;
  };
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaUserClient) {}
  findOrCreateByAuthIdentity(input: {
    provider: AuthProvider;
    providerUserId: string;
    nickname?: string | null;
    email?: string | null;
    phone?: string | null;
    avatarUrl?: string | null; }
  ):Promise<{ user: UserEntity; isNewUser: boolean; }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.userAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: input.provider,
            providerUserId: input.providerUserId,
          },
        },
        include: { user: true },
      });

      if(existing) {
        if (existing.user.status !== "active") {
          return { user: this.toUserEntity(existing.user), isNewUser: false };
        }

        const updatedUser = await tx.user.update({
          where: { id: existing.user.id },
          data: {
            nickname: input.nickname ?? undefined,
            email: input.email ?? undefined,
            phone: input.phone ?? undefined,
            avatarUrl: input.avatarUrl ?? undefined,
          },
        });
        await ensureUserProfile(tx, updatedUser);
        return { user: this.toUserEntity(updatedUser), isNewUser: false };
      }

      const createdUser = await tx.user.create({
        data: {
          nickname: input.nickname ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          avatarUrl: input.avatarUrl ?? null,
          status: "active"
        },
      });
      await ensureUserProfile(tx, createdUser);

      try {
        await tx.userAuthIdentity.create({
          data: {
            userId: createdUser.id,
            provider: input.provider,
            providerUserId: input.providerUserId,
          },
        });

        return { user: this.toUserEntity(createdUser), isNewUser: true };
      } catch {
        const winner = await tx.userAuthIdentity.findUnique({
          where: {
            provider_providerUserId: {
              provider: input.provider,
              providerUserId: input.providerUserId,
            },
          },
          include: { user: true },
        });

        if (winner?.user) {
          return { user: this.toUserEntity(winner.user), isNewUser: false };
        }
        throw new Error("bind auth identity failed");
      }
    });
  }

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
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          nickname: input.nickname ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          avatarUrl: input.avatarUrl ?? null,
          status: "active",
        },
      });
      await ensureUserProfile(tx, user);
      return user;
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
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { id: input.id },
        update: {
          nickname: input.nickname ?? undefined,
          email: input.email ?? undefined,
          phone: input.phone ?? undefined,
          avatarUrl: input.avatarUrl ?? undefined,
          status: input.status ?? undefined,
          role: input.role ?? undefined,
        },
        create: {
          id: input.id,
          nickname: input.nickname ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          avatarUrl: input.avatarUrl ?? null,
          status: input.status ?? "active",
          role: input.role ?? "user",
        },
      });
      await ensureUserProfile(tx, user);
    });
  }

  async findById(userId: string): Promise<UserEntity | null> {
    const row = await this.prisma.user.findUnique({ where: { id: userId } });
    return row ? this.toUserEntity(row) : null;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    const row = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalized,
          mode: "insensitive",
        },
      },
    });
    return row ? this.toUserEntity(row) : null;
  }

  async updateEmailById(userId: string, email: string): Promise<UserEntity> {
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: { email: email.trim().toLowerCase() },
    });
    return this.toUserEntity(row);
  }

  async markPendingDeleteById(userId: string): Promise<UserEntity> {
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: "pending_delete",
        nickname: null,
        email: null,
        phone: null,
        avatarUrl: null,
      },
    });

    return this.toUserEntity(row);
  }


  private toUserEntity(record: {
    id: string;
    nickname: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    status: "active" | "disabled" | "pending_delete";
    role: "user" | "admin";
    createdAt: Date;
    updatedAt: Date;
  }): UserEntity {
    return {
      id: record.id,
      nickname: record.nickname,
      email: record.email,
      phone: record.phone,
      avatarUrl: record.avatarUrl,
      status: record.status,
      role: record.role,
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

async function ensureUserProfile(tx: any, user: { id: string; phone?: string | null }): Promise<void> {
  await tx.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      nickname: generateDefaultProfileNickname(),
      nicknameSource: "default_generated",
      registrationMethod: user.phone ? "phone" : "email",
    },
    update: {},
  });
}
