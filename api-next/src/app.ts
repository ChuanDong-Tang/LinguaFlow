import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { MockAuthProvider } from "@lf/core/ports/auth/MockAuthProvider.js";
import { PrismaUserRepository } from "@lf/server-next/infrastructure/repository/PrismaUserRepository.js";
import { AuthLoginService } from "@lf/server-next/services/auth/AuthLoginService.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerChatStreamRoutes } from "./chat/streamRoutes.js";
import { DeepSeekAIProvider } from "@lf/server-next/providers/ai/DeepSeekAIProvider.js";
import { RewriteService } from "@lf/server-next/services/chat/RewriteService.js";
import { registerChatRoutes } from "./chat/routes.js";
import { PrismaConversationRepository } from "@lf/server-next/infrastructure/repository/PrismaConversationRepository.js";
import { PrismaMessageRepository } from "@lf/server-next/infrastructure/repository/PrismaMessageRepository.js";
import { ChatMessageService } from "@lf/server-next/services/chat/ChatMessageService.js";
import { getRedisClient } from "@lf/server-next/infrastructure/redis/redisClient.js";
import {
  InMemoryRewriteTaskGuard,
  RedisRewriteTaskGuard,
} from "@lf/server-next/services/chat/RewriteTaskGuard.js";
import { PrismaEntitlementRepository } from "@lf/server-next/infrastructure/repository/PrismaEntitlementRepository.js";
import { EntitlementService } from "@lf/server-next/services/entitlement/EntitlementService.js";
import { PrismaAiRequestLogRepository } from "@lf/server-next/infrastructure/repository/PrismaAiRequestLogRepository.js";
import {
  InMemoryRewriteRateLimiter,
  RedisRewriteRateLimiter,
} from "@lf/server-next/services/chat/RewriteRateLimiter.js";

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
