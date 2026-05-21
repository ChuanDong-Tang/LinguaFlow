import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "@lf/server/services/auth/JwtSessionToken.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";

export interface AdminContext {
  adminId: string;
  role: "admin";
}

export interface AdminUserClient {
  findUnique: (args: any) => Promise<{
    id: string;
    role: "user" | "admin";
    status: "active" | "disabled";
  } | null>;
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  userClient: AdminUserClient,
  systemEventLogRepository?: SystemEventLogWriter
): Promise<AdminContext | null> {
  const token = resolveBearerToken(firstHeaderValue(req.headers.authorization));
  if (!token) {
    await writeSystemEventLog(systemEventLogRepository, {
      module: "admin",
      event: "admin.auth.missing_token",
      level: "warn",
      status: "failed",
      errorCode: "ADMIN_UNAUTHORIZED",
      metadata: { path: req.url },
    });
    void reply.status(401).send({
      ok: false,
      error: { code: "ADMIN_UNAUTHORIZED", message: "Admin access token is required" },
    });
    return null;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    await writeSystemEventLog(systemEventLogRepository, {
      module: "admin",
      event: "admin.auth.invalid_token",
      level: "warn",
      status: "failed",
      errorCode: "ADMIN_UNAUTHORIZED",
      metadata: { path: req.url },
    });
    void reply.status(401).send({
      ok: false,
      error: { code: "ADMIN_UNAUTHORIZED", message: "Invalid admin access token" },
    });
    return null;
  }

  const user = await userClient.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });

  if (!user || user.status !== "active") {
    await writeSystemEventLog(systemEventLogRepository, {
      userId: payload.sub,
      module: "admin",
      event: "admin.auth.inactive_account",
      level: "warn",
      status: "failed",
      errorCode: "ADMIN_FORBIDDEN",
      metadata: { path: req.url, status: user?.status ?? null },
    });
    void reply.status(403).send({
      ok: false,
      error: { code: "ADMIN_FORBIDDEN", message: "Admin account is not active" },
    });
    return null;
  }

  if (user.role !== "admin") {
    await writeSystemEventLog(systemEventLogRepository, {
      userId: user.id,
      module: "admin",
      event: "admin.auth.role_denied",
      level: "warn",
      status: "failed",
      errorCode: "ADMIN_FORBIDDEN",
      metadata: { path: req.url, role: user.role },
    });
    void reply.status(403).send({
      ok: false,
      error: { code: "ADMIN_FORBIDDEN", message: "Admin role is required" },
    });
    return null;
  }

  return { adminId: user.id, role: "admin" };
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveBearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  return match?.[1]?.trim() || null;
}
