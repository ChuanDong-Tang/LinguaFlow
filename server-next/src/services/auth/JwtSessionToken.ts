import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionTokenPayload {
  sub: string;
  sid?: string;
  iat: number;
  exp: number;
  typ: "access" | "refresh";
}

const DEFAULT_ACCESS_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const DEFAULT_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function signAccessToken(userId: string): string {
  return signTypedToken(userId, "access", getAccessTokenTtlSeconds());
}

export function signAccessTokenWithSession(userId: string, sessionId: string): string {
  return signTypedToken(userId, "access", getAccessTokenTtlSeconds(), sessionId);
}

export function signRefreshToken(userId: string): string {
  return signTypedToken(userId, "refresh", getRefreshTokenTtlSeconds());
}

export function signRefreshTokenWithSession(userId: string, sessionId: string): string {
  return signTypedToken(userId, "refresh", getRefreshTokenTtlSeconds(), sessionId);
}

export function signSessionToken(userId: string): string {
  return signAccessToken(userId);
}

function signTypedToken(
  userId: string,
  typ: "access" | "refresh",
  ttlSeconds: number,
  sessionId?: string
): string {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      ...(sessionId ? { sid: sessionId } : {}),
      typ,
      iat: now,
      exp: now + ttlSeconds,
    })
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsignedToken).digest("base64url");
  return `${unsignedToken}.${signature}`;
}

export function verifyAccessToken(token: string): SessionTokenPayload | null {
  return verifyTypedToken(token, "access");
}

export function verifyRefreshToken(token: string): SessionTokenPayload | null {
  return verifyTypedToken(token, "refresh");
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  return verifyAccessToken(token);
}

function verifyTypedToken(token: string, expectedType: "access" | "refresh"): SessionTokenPayload | null {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;

  const unsignedToken = `${header}.${payload}`;
  const expected = createHmac("sha256", getJwtSecret())
    .update(unsignedToken)
    .digest("base64url");

  if (!safeEqual(signature, expected)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionTokenPayload>;
    if (!decoded.sub || typeof decoded.sub !== "string") return null;
    if (typeof decoded.iat !== "number") return null;
    if (typeof decoded.exp !== "number") return null;
    if (decoded.typ !== expectedType) return null;
    if (decoded.sid !== undefined && typeof decoded.sid !== "string") return null;
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp <= now) return null;
    return {
      sub: decoded.sub,
      ...(typeof decoded.sid === "string" ? { sid: decoded.sid } : {}),
      iat: decoded.iat,
      exp: decoded.exp,
      typ: decoded.typ,
    };
  } catch {
    return null;
  }
}

function getJwtSecret(): string {
  return process.env.AUTH_JWT_SECRET ?? "dev-only-change-me";
}

function getAccessTokenTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ACCESS_TTL_SECONDS;
}

function getRefreshTokenTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_TTL_SECONDS;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}
