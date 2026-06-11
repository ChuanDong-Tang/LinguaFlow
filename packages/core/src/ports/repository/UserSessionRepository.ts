export interface UserSessionEntity {
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
}

export interface CreateUserSessionInput {
  id: string;
  userId: string;
  refreshTokenHash: string;
  userAgent?: string | null;
  ip?: string | null;
  expiresAt: Date;
}

export interface UpdateUserSessionInput {
  id: string;
  refreshTokenHash?: string;
  expiresAt?: Date;
  revokedAt?: Date | null;
  replacedBySessionId?: string | null;
  lastUsedAt?: Date | null;
  userAgent?: string | null;
  ip?: string | null;
}

export interface RotateUserSessionInput {
  currentSessionId: string;
  revokedAt: Date;
  replacedBySessionId: string;
  lastUsedAt: Date;
  nextSession: CreateUserSessionInput;
}

export interface UserSessionRepository {
  create(input: CreateUserSessionInput): Promise<UserSessionEntity>;
  findById(id: string): Promise<UserSessionEntity | null>;
  update(input: UpdateUserSessionInput): Promise<UserSessionEntity>;
  rotateSession(input: RotateUserSessionInput): Promise<void>;
  listActiveByUserId(userId: string): Promise<UserSessionEntity[]>;
  revokeAllByUserId(userId: string, revokedAt: Date): Promise<number>;
}
