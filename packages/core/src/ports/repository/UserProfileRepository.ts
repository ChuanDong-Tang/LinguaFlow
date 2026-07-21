import type { ProfileNicknameSource, RegistrationMethod } from "../../types/profile.js";

export interface UserProfileEntity {
  userId: string;
  nickname: string;
  nicknameSource: ProfileNicknameSource;
  registrationMethod: RegistrationMethod;
  avatarAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserBindingEntity {
  userId: string;
  phone: string | null;
  email: string | null;
}

export interface UserAvatarAssetEntity {
  id: string;
  userId: string;
  status: string;
  originalObjectKey: string;
  uploadObjectKey: string | null;
  profileObjectKey: string | null;
  thumbnailObjectKey: string | null;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  expiresAt: Date | null;
}

export interface UserProfileRepository {
  ensure(input: {
    userId: string;
    defaultNickname: string;
    registrationMethod: RegistrationMethod;
  }): Promise<UserProfileEntity>;
  findByUserId(userId: string): Promise<UserProfileEntity | null>;
  updateNickname(input: {
    userId: string;
    nickname: string;
    nicknameSource: ProfileNicknameSource;
  }): Promise<UserProfileEntity>;
  clearAvatar(userId: string): Promise<UserProfileEntity>;
  findBindings(userId: string): Promise<UserBindingEntity | null>;
  createAvatarAsset(input: {
    id: string; userId: string; originalObjectKey: string; mimeType: string;
    fileSize: number; width: number; height: number; expiresAt: Date;
  }): Promise<UserAvatarAssetEntity>;
  findAvatarAsset(id: string, userId: string): Promise<UserAvatarAssetEntity | null>;
  findCurrentAvatar(userId: string): Promise<UserAvatarAssetEntity | null>;
  activateAvatar(input: {
    id: string; userId: string; originalObjectKey: string; profileObjectKey: string; thumbnailObjectKey: string;
    fileMd5: string; moderationRequestId: string; moderationSuggestion: string;
    moderationLabel: string;
  }): Promise<{ current: UserAvatarAssetEntity; previous: UserAvatarAssetEntity | null }>;
  markAvatarFailed(id: string, userId: string, status: string): Promise<void>;
  removeCurrentAvatar(userId: string): Promise<UserAvatarAssetEntity | null>;
  listAvatarAssetsForCleanup(now: Date, limit: number): Promise<UserAvatarAssetEntity[]>;
  deleteUnusedAvatarAsset(id: string): Promise<boolean>;
  listAvatarUploadObjectsForCleanup(limit: number): Promise<UserAvatarAssetEntity[]>;
  clearAvatarUploadObjectKey(id: string, objectKey: string): Promise<boolean>;
}
