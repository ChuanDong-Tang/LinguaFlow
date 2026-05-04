import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "@lf/server-next/services/auth/JwtSessionToken.js";

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
  userClient: AdminUserClient
): Promise<AdminContext | null> {
  const token = resolveBearerToken(firstHeaderValue(req.headers.authorization));
  if (!token) {
    void reply.status(401).send({
      ok: false,
      error: { code: "ADMIN_UNAUTHORIZED", message: "Admin access token is required" },
    });
    return null;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
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
    void reply.status(403).send({
      ok: false,
      error: { code: "ADMIN_FORBIDDEN", message: "Admin account is not active" },
    });
    return null;
  }

  if (user.role !== "admin") {
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
