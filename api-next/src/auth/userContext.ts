import { verifySessionToken } from "@lf/server-next/services/auth/JwtSessionToken.js";

export type UserContext = {
  userId: string;
  source: "mock" | "auth";
};

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";

  constructor(message = "Unauthorized") {
    super(message);
  }
}

export function isMockAuthEnabled(): boolean {
  return process.env.LF_ALLOW_MOCK_AUTH === "true";
}

export function getAllowedMockUserIds(): string[] {
  return (process.env.LF_MOCK_USER_IDS ?? "mock_user_001")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAllowedMockUserId(userId: string): boolean {
  return getAllowedMockUserIds().includes(userId.trim());
}

export function resolveUserContext(input: {
  authorization?: string;
  bodyUserId?: string;
  mockUserId?: string;
  allowMockFallback?: boolean;
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

  const userId = (input.bodyUserId ?? input.mockUserId)?.trim();
  const allowMockFallback = input.allowMockFallback ?? isMockAuthEnabled();
  const isAllowedMockUser = userId ? isAllowedMockUserId(userId) : false;

  if (allowMockFallback && isAllowedMockUser && userId) {
    return {
      userId,
      source: "mock",
    };
  }

  throw new UnauthorizedError();
}

function resolveBearerToken(authorization: string): string | null {
  const trimmed = authorization.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match?.[1]?.trim() || null;
}
