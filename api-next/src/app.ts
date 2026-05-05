import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { MockAuthProvider } from "@lf/core/ports/auth/MockAuthProvider.js";
import { PrismaUserRepository } from "@lf/server-next/infrastructure/repository/PrismaUserRepository.js";
import { PrismaUserSessionRepository } from "@lf/server-next/infrastructure/repository/PrismaUserSessionRepository.js";
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
import { PrismaSubscriptionRepository } from "@lf/server-next/infrastructure/repository/PrismaSubscriptionRepository.js";
import { PrismaPaymentOrderRepository } from "@lf/server-next/infrastructure/repository/PrismaPaymentOrderRepository.js";
import { PrismaPaymentEventRepository } from "@lf/server-next/infrastructure/repository/PrismaPaymentEventRepository.js";
import { EntitlementService } from "@lf/server-next/services/entitlement/EntitlementService.js";
import { SubscriptionService } from "@lf/server-next/services/subscription/SubscriptionService.js";
import { PaymentOrderService } from "@lf/server-next/services/payment/PaymentOrderService.js";
import { PaymentNotifyService } from "@lf/server-next/services/payment/PaymentNotifyService.js";
import { AppleIapService } from "@lf/server-next/services/payment/AppleIapService.js";
import { PaymentEntitlementService } from "@lf/server-next/services/payment/PaymentEntitlementService.js";
import { WeChatPaymentProvider } from "@lf/server-next/providers/payment/WeChatPaymentProvider.js";
import { PrismaAiRequestLogRepository } from "@lf/server-next/infrastructure/repository/PrismaAiRequestLogRepository.js";
import { PrismaSystemEventLogRepository } from "@lf/server-next/infrastructure/repository/PrismaSystemEventLogRepository.js";
import {
  InMemoryRewriteRateLimiter,
  RedisRewriteRateLimiter,
} from "@lf/server-next/services/chat/RewriteRateLimiter.js";
import { registerMeRoutes } from "./me/routes.js";
import { registerPaymentRoutes } from "./payment/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { getRuntimeConfig } from "@lf/server-next/config/runtimeConfig.js";

const prisma = new PrismaClient();

export function createApp() {
  const app = Fastify({ logger: true });
  const corsAllowOrigins = resolveCorsAllowOrigins();
  app.addHook("onRequest", async (req, reply) => {
    const requestOrigin = firstHeaderValue(req.headers.origin);
    const allowOrigin = resolveAllowOrigin(requestOrigin, corsAllowOrigins);
    if (allowOrigin) {
      reply.header("Access-Control-Allow-Origin", allowOrigin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    }

    if (req.method === "OPTIONS") {
      if (!allowOrigin) {
        return reply.status(403).send();
      }
      return reply.status(204).send();
    }
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const rawBody = String(body);
        done(null, Object.assign(JSON.parse(rawBody), { __rawBody: rawBody }));
      } catch (error) {
        done(error as Error);
      }
    }
  );

  const authProvider = new MockAuthProvider();
  const userRepository = new PrismaUserRepository(prisma);
  const userSessionRepository = new PrismaUserSessionRepository(prisma);
  const authLoginService = new AuthLoginService(userRepository, userSessionRepository);
  const runtimeConfig = getRuntimeConfig();
  const aiProvider = new DeepSeekAIProvider({
    apiKey: runtimeConfig.deepSeekApiKey,
    baseUrl: runtimeConfig.deepSeekBaseUrl,
    model: runtimeConfig.deepSeekModel,
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
  const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
  const subscriptionService = new SubscriptionService(subscriptionRepository);
  const entitlementService = new EntitlementService(entitlementRepository, subscriptionService);
  const paymentOrderRepository = new PrismaPaymentOrderRepository(prisma);
  const paymentEventRepository = new PrismaPaymentEventRepository(prisma);
  const systemEventLogRepository = new PrismaSystemEventLogRepository(prisma);
  const paymentProvider = new WeChatPaymentProvider();
  const paymentOrderService = new PaymentOrderService(paymentOrderRepository, paymentProvider);
  const paymentEntitlementService = new PaymentEntitlementService(subscriptionService);
  const paymentNotifyService = new PaymentNotifyService(
    paymentEventRepository,
    paymentOrderRepository,
    paymentEntitlementService
  );
  const appleIapService = new AppleIapService(paymentEntitlementService, paymentEventRepository);
  const aiRequestLogRepository = new PrismaAiRequestLogRepository(prisma);
  const rewriteService = new RewriteService(
    aiProvider,
    chatMessageService,
    rewriteTaskGuard,
    entitlementService,
    aiRequestLogRepository,
    rewriteRateLimiter
  );

  registerChatStreamRoutes(app, {
    rewriteService,
    userRepository,
    systemEventLogRepository,
  });
  registerAuthRoutes(app, {
    authProvider,
    authLoginService,
    userRepository,
    systemEventLogRepository,
  });
  registerChatRoutes(app, {
    chatMessageService,
    userRepository,
    systemEventLogRepository,
  });
  registerMeRoutes(app, {
    subscriptionService,
    entitlementService,
    userRepository,
    systemEventLogRepository,
  });
  registerPaymentRoutes(app, {
    paymentOrderService,
    paymentNotifyService,
    appleIapService,
    userRepository,
    systemEventLogRepository,
  });
  registerAdminRoutes(app, { prisma, subscriptionService, systemEventLogRepository });

  app.get("/health", async (_req, reply) => {
    const db = await prisma
      .$queryRaw`SELECT 1`
      .then(() => ({ ok: true }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    const redis = redisClient
      ? await redisClient
          .ping()
          .then(() => ({ ok: true }))
          .catch((error) => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }))
      : { ok: true, skipped: true };
    const ok = db.ok && redis.ok;

    return reply.status(ok ? 200 : 503).send({
      ok,
      data: {
        api: { ok: true },
        db,
        redis,
      },
    });
  });

  return app;
}

function resolveCorsAllowOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.CORS_ALLOW_ORIGINS?.trim();
  if (!raw) {
    return new Set(["http://localhost:3103", "http://localhost:8081", "http://localhost:5173"]);
  }
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function resolveAllowOrigin(origin: string | undefined, allowOrigins: Set<string>): string | null {
  if (!origin) return null;
  return allowOrigins.has(origin) ? origin : null;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function disconnectApp() {
  await prisma.$disconnect();
}
