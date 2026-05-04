/** UserRepository：定义用户数据读写接口（不关心具体数据库实现）。 */

export type AuthProvider = "authing";
export type UserStatus = "active" | "disabled";
export type UserRole = "user" | "admin";

/** 用户主数据 */
export interface UserEntity {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

/** 登录身份绑定数据（V1 先绑定 Authing 用户身份） */
export interface UserAuthIdentity {
  userId: string;
  provider: AuthProvider;
  providerUserId: string; // Authing user id / OIDC sub
  createdAt: Date;
}

/** 创建用户入参 */
export interface CreateUserInput {
  nickname?: string | null;
  avatarUrl?: string | null;
}

/** 绑定登录身份入参 */
export interface BindAuthIdentityInput {
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
}

export interface EnsureUserExistsInput {
  id: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  status?: UserStatus;
  role?: UserRole;
}

/** 用户数据仓储接口（V1 最小闭环） */
export interface UserRepository {
  findByAuthIdentity(
    provider: AuthProvider,
    providerUserId: string
  ): Promise<UserEntity | null>;

  create(input: CreateUserInput): Promise<UserEntity>;

  bindAuthIdentity(input: BindAuthIdentityInput): Promise<UserAuthIdentity>;

  ensureUserExists(input: EnsureUserExistsInput): Promise<void>;

  findById(userId: string): Promise<UserEntity | null>;
}
