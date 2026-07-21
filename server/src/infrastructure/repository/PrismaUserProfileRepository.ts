import type {
  UserBindingEntity,
  UserProfileEntity,
  UserProfileRepository,
  UserAvatarAssetEntity,
} from "@lf/core/ports/repository/UserProfileRepository.js";
import type { ProfileNicknameSource, RegistrationMethod } from "@lf/core/types/profile.js";

type PrismaUserProfileClient = {
  userProfile: {
    upsert: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  user: {
    findUnique: (args: any) => Promise<any>;
  };
  userAvatarAsset: {
    create: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

export class PrismaUserProfileRepository implements UserProfileRepository {
  constructor(private readonly prisma: PrismaUserProfileClient) {}

  async ensure(input: {
    userId: string;
    defaultNickname: string;
    registrationMethod: RegistrationMethod;
  }): Promise<UserProfileEntity> {
    const row = await this.prisma.userProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        nickname: input.defaultNickname,
        nicknameSource: "default_generated",
        registrationMethod: input.registrationMethod,
      },
      update: {},
    });
    return toEntity(row);
  }

  async findByUserId(userId: string): Promise<UserProfileEntity | null> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    return row ? toEntity(row) : null;
  }

  async updateNickname(input: {
    userId: string;
    nickname: string;
    nicknameSource: ProfileNicknameSource;
  }): Promise<UserProfileEntity> {
    const row = await this.prisma.userProfile.update({
      where: { userId: input.userId },
      data: {
        nickname: input.nickname,
        nicknameSource: input.nicknameSource,
      },
    });
    return toEntity(row);
  }

  async clearAvatar(userId: string): Promise<UserProfileEntity> {
    const row = await this.prisma.userProfile.update({
      where: { userId },
      data: { avatarAssetId: null },
    });
    return toEntity(row);
  }

  async findBindings(userId: string): Promise<UserBindingEntity | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, email: true },
    });
    return row ? { userId: row.id, phone: row.phone ?? null, email: row.email ?? null } : null;
  }

  async createAvatarAsset(input: {
    id: string; userId: string; originalObjectKey: string; mimeType: string;
    fileSize: number; width: number; height: number; expiresAt: Date;
  }): Promise<UserAvatarAssetEntity> {
    return toAvatar(await this.prisma.userAvatarAsset.create({
      data: { ...input, uploadObjectKey: input.originalObjectKey, status: "uploading" },
    }));
  }

  async findAvatarAsset(id: string, userId: string): Promise<UserAvatarAssetEntity | null> {
    const row = await this.prisma.userAvatarAsset.findFirst({ where: { id, userId } });
    return row ? toAvatar(row) : null;
  }

  async findCurrentAvatar(userId: string): Promise<UserAvatarAssetEntity | null> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { avatarAsset: true },
    });
    return profile?.avatarAsset ? toAvatar(profile.avatarAsset) : null;
  }

  async activateAvatar(input: {
    id: string; userId: string; originalObjectKey: string; profileObjectKey: string; thumbnailObjectKey: string;
    fileMd5: string; moderationRequestId: string; moderationSuggestion: string;
    moderationLabel: string;
  }): Promise<{ current: UserAvatarAssetEntity; previous: UserAvatarAssetEntity | null }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT "userId" FROM "user_profiles" WHERE "userId" = $1 FOR UPDATE',
        input.userId,
      );
      const profile = await tx.userProfile.findUnique({ where: { userId: input.userId }, select: { avatarAssetId: true } });
      const previous = profile?.avatarAssetId
        ? await tx.userAvatarAsset.findFirst({ where: { id: profile.avatarAssetId, userId: input.userId } })
        : null;
      const current = await tx.userAvatarAsset.update({
        where: { id: input.id },
        data: {
          status: "ready",
          originalObjectKey: input.originalObjectKey,
          profileObjectKey: input.profileObjectKey,
          thumbnailObjectKey: input.thumbnailObjectKey,
          fileMd5: input.fileMd5,
          moderationRequestId: input.moderationRequestId,
          moderationSuggestion: input.moderationSuggestion,
          moderationLabel: input.moderationLabel,
          moderatedAt: new Date(),
          claimedAt: new Date(),
        },
      });
      await tx.userProfile.update({ where: { userId: input.userId }, data: { avatarAssetId: input.id } });
      if (previous && previous.id !== input.id) {
        await tx.userAvatarAsset.update({ where: { id: previous.id }, data: { status: "cleanup_pending" } });
      }
      return { current: toAvatar(current), previous: previous ? toAvatar(previous) : null };
    });
  }

  async markAvatarFailed(id: string, userId: string, status: string): Promise<void> {
    await this.prisma.userAvatarAsset.updateMany({ where: { id, userId, status: { not: "ready" } }, data: { status } });
  }

  async removeCurrentAvatar(userId: string): Promise<UserAvatarAssetEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT "userId" FROM "user_profiles" WHERE "userId" = $1 FOR UPDATE',
        userId,
      );
      const profile = await tx.userProfile.findUnique({ where: { userId }, select: { avatarAssetId: true } });
      if (!profile?.avatarAssetId) return null;
      const asset = await tx.userAvatarAsset.findFirst({ where: { id: profile.avatarAssetId, userId } });
      await tx.userProfile.update({ where: { userId }, data: { avatarAssetId: null } });
      if (asset) await tx.userAvatarAsset.update({ where: { id: asset.id }, data: { status: "cleanup_pending" } });
      return asset ? toAvatar(asset) : null;
    });
  }

  async listAvatarAssetsForCleanup(now: Date, limit: number): Promise<UserAvatarAssetEntity[]> {
    const rows = await this.prisma.userAvatarAsset.findMany({
      where: {
        currentForProfile: null,
        OR: [
          { status: { in: ["cleanup_pending", "rejected", "moderation_failed", "derivation_failed"] } },
          { status: "uploading", expiresAt: { lt: now } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }],
      take: Math.max(1, limit),
    });
    return rows.map(toAvatar);
  }

  async deleteUnusedAvatarAsset(id: string): Promise<boolean> {
    const result = await this.prisma.userAvatarAsset.deleteMany({
      where: { id, currentForProfile: null },
    });
    return result.count === 1;
  }

  async listAvatarUploadObjectsForCleanup(limit: number): Promise<UserAvatarAssetEntity[]> {
    const rows = await this.prisma.userAvatarAsset.findMany({
      where: { status: "ready", uploadObjectKey: { not: null } },
      orderBy: [{ updatedAt: "asc" }],
      take: Math.max(1, limit),
    });
    return rows.map(toAvatar);
  }

  async clearAvatarUploadObjectKey(id: string, objectKey: string): Promise<boolean> {
    const result = await this.prisma.userAvatarAsset.updateMany({
      where: { id, uploadObjectKey: objectKey },
      data: { uploadObjectKey: null },
    });
    return result.count === 1;
  }
}

function toEntity(row: any): UserProfileEntity {
  return {
    userId: row.userId,
    nickname: row.nickname,
    nicknameSource: row.nicknameSource as ProfileNicknameSource,
    registrationMethod: row.registrationMethod as RegistrationMethod,
    avatarAssetId: row.avatarAssetId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAvatar(row: any): UserAvatarAssetEntity {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    originalObjectKey: row.originalObjectKey,
    uploadObjectKey: row.uploadObjectKey ?? null,
    profileObjectKey: row.profileObjectKey ?? null,
    thumbnailObjectKey: row.thumbnailObjectKey ?? null,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    expiresAt: row.expiresAt ?? null,
  };
}
