import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { MockAuthProvider } from "@lf/core/ports/auth/MockAuthProvider";
import { PrismaUserRepository } from "@lf/server-next/infrastructure/repository/PrismaUserRepository";
import { AuthLoginService } from "@lf/server-next/services/auth/AuthLoginService";
import { registerAuthRoutes } from "./auth/routes";
import { registerChatStreamRoutes } from "./chat/streamRoutes";
import { DeepSeekAIProvider } from "@lf/server-next/providers/ai/DeepSeekAIProvider";
import { RewriteService } from "@lf/server-next/services/chat/RewriteService";
import { registerChatRoutes } from "./chat/routes";
import { PrismaConversationRepository } from "@lf/server-next/infrastructure/repository/PrismaConversationRepository";
import { PrismaMessageRepository } from "@lf/server-next/infrastructure/repository/PrismaMessageRepository";
import { ChatMessageService } from "@lf/server-next/services/chat/ChatMessageService";
import { getRedisClient } from "@lf/server-next/infrastructure/redis/redisClient";
import {
  InMemoryRewriteTaskGuard,
  RedisRewriteTaskGuard,
} from "@lf/server-next/services/chat/RewriteTaskGuard";
import { PrismaEntitlementRepository } from "@lf/server-next/infrastructure/repository/PrismaEntitlementRepository";
import { EntitlementService } from "@lf/server-next/services/entitlement/EntitlementService";
import { PrismaAiRequestLogRepository } from "@lf/server-next/infrastructure/repository/PrismaAiRequestLogRepository";
import {
  InMemoryRewriteRateLimiter,
  RedisRewriteRateLimiter,
} from "@lf/server-next/services/chat/RewriteRateLimiter";

const prisma = new PrismaClient();

export function createApp() {
  const app = Fastify({ logger: true });

  const authProvider = new MockAuthProvider();
  const userRepository = new PrismaUserRepository(prisma);
  const authLoginService = new AuthLoginService(userRepository);
  const aiProvider = new DeepSeekAIProvider({
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  });
  const conversationRepository = new PrismaConversationRepository(prisma);
  const messageRepository = new PrismaMessageRepository(prisma);
  const chatMessageService = new ChatMessageService(conversationRepository, messageRepository);
  const redisClient = getRedisClient();
  const rewriteTaskGuard = redisClient
    ? new RedisRewriteTaskGuard(redisClient)
    : new InMemoryRewriteTaskGuard();
  const rewriteRateLimiter = redisClient
    ? new RedisRewriteRateLimiter(redisClient)
    : new InMemoryRewriteRateLimiter();
  const entitlementRepository = new PrismaEntitlementRepository(prisma);
  const entitlementService = new EntitlementService(entitlementRepository);
  const aiRequestLogRepository = new PrismaAiRequestLogRepository(prisma);
  const rewriteService = new RewriteService(
    aiProvider,
    chatMessageService,
    rewriteTaskGuard,
    entitlementService,
    aiRequestLogRepository,
    rewriteRateLimiter
  );

  registerChatStreamRoutes(app, { rewriteService });
  registerAuthRoutes(app, {
    authProvider,
    authLoginService,
    userRepository,
  });
  registerChatRoutes(app, {
    chatMessageService,
    userRepository,
  });

  app.get("/health", async () => {
    return { ok: true };
  });

  return app;
}

export async function disconnectApp() {
  await prisma.$disconnect();
}
