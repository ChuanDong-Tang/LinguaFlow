import { verifySessionToken } from "@lf/server/services/auth/JwtSessionToken.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";

export type UserContext = {
  userId: string;
  source: "auth";
};

export interface UserStatusLookup {
  findById: (userId: string) => Promise<{
    id: string;
    status: "active" | "disabled" | "pending_delete";
  } | null>;
}

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";

  constructor(message = "Unauthorized") {
    super(message);
  }
}

export class AccountDisabledError extends Error {
  readonly code = "ACCOUNT_DISABLED";

  constructor(message = "Account is disabled") {
    super(message);
  }
}

export class AccountPendingDeleteError extends Error {
  readonly code = "ACCOUNT_PENDING_DELETE";

  constructor(message = "Account deletion is in progress") {
    super(message);
  }
}

export function isMockAuthEnabled(): boolean {
  return getRuntimeConfig().allowMockAuth;
}

export function getAllowedMockUserIds(): string[] {
  return getRuntimeConfig().mockUserIds;
}

export function isAllowedMockUserId(userId: string): boolean {
  return getAllowedMockUserIds().includes(userId.trim());
}

export function resolveUserContext(input: {
  authorization?: string;
}): UserContext {
  if (input.authorization) {
    const token = resolveBearerToken(input.authorization);
    if (!token) throw new UnauthorizedError("Invalid Authorization header");

    const payload = verifySessionToken(token);
    if (!payload) throw new UnauthorizedError("Invalid access token");

    return {
      userId: payload.sub,
      source: "auth",
    };
  }

  throw new UnauthorizedError();
}

export async function resolveActiveUserContext(input: {
  authorization?: string;
  userRepository: UserStatusLookup;
}): Promise<UserContext> {
  const context = resolveUserContext(input);
  const user = await input.userRepository.findById(context.userId);

  if (user?.status === "pending_delete") {
    throw new AccountPendingDeleteError();
  }

  if (user?.status === "disabled") {
    throw new AccountDisabledError();
  }

  if (!user && context.source === "auth") {
    throw new UnauthorizedError("Account not found");
  }

  return context;
}

function resolveBearerToken(authorization: string): string | null {
  const trimmed = authorization.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match?.[1]?.trim() || null;
}
