import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { MockAuthProvider } from "@lf/core/ports/auth/MockAuthProvider.js";
import { PrismaUserRepository } from "@lf/server/infrastructure/repository/PrismaUserRepository.js";
import { PrismaUserPreferenceRepository } from "@lf/server/infrastructure/repository/PrismaUserPreferenceRepository.js";
import { PrismaUserSessionRepository } from "@lf/server/infrastructure/repository/PrismaUserSessionRepository.js";
import { PrismaTtsAssetRepository } from "@lf/server/infrastructure/repository/PrismaTtsAssetRepository.js";
import { PrismaTtsRequestLogRepository } from "@lf/server/infrastructure/repository/PrismaTtsRequestLogRepository.js";
import { AuthLoginService } from "@lf/server/services/auth/AuthLoginService.js";
import { AccountDeletionService } from "@lf/server/services/auth/AccountDeletionService.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerChatStreamRoutes } from "./chat/streamRoutes.js";
import { createAIProvider } from "@lf/server/providers/ai/createAIProvider.js";
import { ChatGenerationService } from "@lf/server/services/chat/ChatGenerationService.js";
import { registerChatRoutes } from "./chat/routes.js";
import { PrismaConversationRepository } from "@lf/server/infrastructure/repository/PrismaConversationRepository.js";
import { PrismaMessageRepository } from "@lf/server/infrastructure/repository/PrismaMessageRepository.js";
import { ChatMessageService } from "@lf/server/services/chat/ChatMessageService.js";
import { seedSystemContacts } from "@lf/server/services/chat/SystemContactSeeder.js";
import { getRedisClient } from "@lf/server/infrastructure/redis/redisClient.js";
import {
  InMemoryChatGenerationTaskGuard,
  RedisChatGenerationTaskGuard,
} from "@lf/server/services/chat/ChatGenerationTaskGuard.js";
import { PrismaEntitlementRepository } from "@lf/server/infrastructure/repository/PrismaEntitlementRepository.js";
import { PrismaSubscriptionRepository } from "@lf/server/infrastructure/repository/PrismaSubscriptionRepository.js";
import { PrismaPaymentOrderRepository } from "@lf/server/infrastructure/repository/PrismaPaymentOrderRepository.js";
import { PrismaPaymentEventRepository } from "@lf/server/infrastructure/repository/PrismaPaymentEventRepository.js";
import { PrismaBenefitGrantRepository } from "@lf/server/infrastructure/repository/PrismaBenefitGrantRepository.js";
import { EntitlementService } from "@lf/server/services/entitlement/EntitlementService.js";
import { SubscriptionService } from "@lf/server/services/subscription/SubscriptionService.js";
import { PaymentOrderService } from "@lf/server/services/payment/PaymentOrderService.js";
import { PaymentNotifyService } from "@lf/server/services/payment/PaymentNotifyService.js";
import { AppleIapService } from "@lf/server/providers/payment/apple/AppleIapService.js";
import { PaymentEntitlementService } from "@lf/server/services/payment/PaymentEntitlementService.js";
import { BenefitGrantService } from "@lf/server/services/payment/BenefitGrantService.js";
import { WeChatPaymentProvider } from "@lf/server/providers/payment/wechat/WeChatPaymentProvider.js";
import { WeChatAutoRenewProvider } from "@lf/server/providers/payment/wechat/WeChatAutoRenewProvider.js";
import { PrismaAiRequestLogRepository } from "@lf/server/infrastructure/repository/PrismaAiRequestLogRepository.js";
import { PrismaSystemEventLogRepository } from "@lf/server/infrastructure/repository/PrismaSystemEventLogRepository.js";
import { PrismaTrustedCertRepository } from "@lf/server/infrastructure/repository/PrismaTrustedCertRepository.js";
import { PrismaAutoRenewRepository } from "@lf/server/infrastructure/repository/PrismaAutoRenewRepository.js";
import { PrismaAppleIapAccountLinkRepository } from "@lf/server/infrastructure/repository/PrismaAppleIapAccountLinkRepository.js";
import {
  InMemoryChatGenerationRateLimiter,
  RedisChatGenerationRateLimiter,
} from "@lf/server/services/chat/ChatGenerationRateLimiter.js";
import { registerMeRoutes } from "./me/routes.js";
import { registerPaymentRoutes } from "./payment/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { registerTtsRoutes } from "./tts/routes.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";
import { PaymentCertSyncService } from "@lf/server/services/payment/PaymentCertSyncService.js";
import { AutoRenewService } from "@lf/server/services/payment/AutoRenewService.js";
import { PaymentEntitlementRefreshService } from "@lf/server/services/payment/PaymentEntitlementRefreshService.js";
import { getBusinessClockSnapshot } from "@lf/server/services/time/businessClock.js";
import { TtsService } from "@lf/server/services/tts/TtsService.js";
import { AzureGlobalTtsProvider } from "@lf/server/providers/tts/AzureGlobalTtsProvider.js";
import { CosStorageProvider } from "@lf/server/providers/storage/CosStorageProvider.js";
import type {
  CreateProviderOrderInput,
  CreateProviderOrderResult,
  PaymentProvider,
  QueryProviderOrderInput,
  QueryProviderOrderResult,
} from "@lf/core/ports/payment/index.js";

const prisma = new PrismaClient();

export function createApp() {
  const app = Fastify({ logger: true, trustProxy: true });
  app.addHook("onReady", async () => {
    await seedSystemContacts(prisma);
  });
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
  const userPreferenceRepository = new PrismaUserPreferenceRepository(prisma);
  const userSessionRepository = new PrismaUserSessionRepository(prisma);
  const ttsAssetRepository = new PrismaTtsAssetRepository(prisma);
  const ttsRequestLogRepository = new PrismaTtsRequestLogRepository(prisma);
  const authLoginService = new AuthLoginService(userRepository, userSessionRepository);
  const accountDeletionService = new AccountDeletionService(userRepository, userSessionRepository);
  const runtimeConfig = getRuntimeConfig();
  const aiProvider = createAIProvider(runtimeConfig);
  const conversationRepository = new PrismaConversationRepository(prisma);
  const messageRepository = new PrismaMessageRepository(prisma);
  const chatMessageService = new ChatMessageService(conversationRepository, messageRepository);
  const redisClient = getRedisClient();
  const chatGenerationTaskGuard = redisClient
    ? new RedisChatGenerationTaskGuard(redisClient)
    : new InMemoryChatGenerationTaskGuard();
  const chatGenerationRateLimiter = redisClient
    ? new RedisChatGenerationRateLimiter(redisClient)
    : new InMemoryChatGenerationRateLimiter();
  const entitlementRepository = new PrismaEntitlementRepository(prisma);
  const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
  const subscriptionService = new SubscriptionService(subscriptionRepository);
  const entitlementService = new EntitlementService(entitlementRepository, subscriptionService);
  const paymentOrderRepository = new PrismaPaymentOrderRepository(prisma);
  const paymentEventRepository = new PrismaPaymentEventRepository(prisma);
  const benefitGrantRepository = new PrismaBenefitGrantRepository(prisma);
  const systemEventLogRepository = new PrismaSystemEventLogRepository(prisma);
  const trustedCertRepository = new PrismaTrustedCertRepository(prisma);
  const autoRenewRepository = new PrismaAutoRenewRepository(prisma);
  const appleIapAccountLinkRepository = new PrismaAppleIapAccountLinkRepository(prisma);
  const paymentProvider = runtimeConfig.payment.wechatPayEnabled
    ? new WeChatPaymentProvider()
    : new DisabledWeChatPaymentProvider();
  const weChatAutoRenewProvider = runtimeConfig.payment.wechatPayEnabled
    ? new WeChatAutoRenewProvider()
    : undefined;
  const paymentOrderService = new PaymentOrderService(
    paymentOrderRepository,
    paymentProvider,
    subscriptionService
  );
  const paymentEntitlementService = new PaymentEntitlementService(
    subscriptionService,
    autoRenewRepository
  );
  const benefitGrantService = new BenefitGrantService(benefitGrantRepository);
  const paymentCertSyncService = new PaymentCertSyncService(trustedCertRepository);
  const paymentNotifyService = new PaymentNotifyService(
    paymentEventRepository,
    paymentOrderRepository,
    benefitGrantService,
    paymentEntitlementService,
    trustedCertRepository,
    paymentCertSyncService
  );
  const autoRenewService = new AutoRenewService(
    autoRenewRepository,
    paymentEntitlementService,
    weChatAutoRenewProvider,
    systemEventLogRepository,
    subscriptionService
  );
  const paymentEntitlementRefreshService = new PaymentEntitlementRefreshService(
    paymentOrderService,
    autoRenewService,
    entitlementService,
    paymentEntitlementService,
    benefitGrantService
  );
  const appleIapService = new AppleIapService(
    benefitGrantService,
    paymentEntitlementService,
    paymentEventRepository,
    paymentOrderRepository,
    autoRenewService,
    appleIapAccountLinkRepository,
    subscriptionService
  );
  const aiRequestLogRepository = new PrismaAiRequestLogRepository(prisma);
  const chatGenerationService = new ChatGenerationService(
    aiProvider,
    chatMessageService,
    chatGenerationTaskGuard,
    entitlementService,
    aiRequestLogRepository,
    chatGenerationRateLimiter,
    conversationRepository,
    userPreferenceRepository
  );
  const ttsService = new TtsService(
    messageRepository,
    userPreferenceRepository,
    ttsAssetRepository,
    entitlementService,
    new AzureGlobalTtsProvider(),
    new CosStorageProvider(),
    ttsRequestLogRepository,
    redisClient
  );

  registerChatStreamRoutes(app, {
    chatGenerationService,
    userRepository,
    chatMessageService,
    systemEventLogRepository,
  });
  registerAuthRoutes(app, {
    authProvider,
    authLoginService,
    accountDeletionService,
    userRepository,
    systemEventLogRepository,
  });
  registerChatRoutes(app, {
    chatMessageService,
    userRepository,
    systemEventLogRepository,
    entitlementService,
    rateLimiter: chatGenerationRateLimiter,
  });
  registerMeRoutes(app, {
    subscriptionService,
    entitlementService,
    paymentEntitlementRefreshService,
    userPreferenceRepository,
    userRepository,
    systemEventLogRepository,
  });
  registerPaymentRoutes(app, {
    paymentOrderService,
    paymentNotifyService,
    autoRenewService,
    appleIapService,
    userRepository,
    systemEventLogRepository,
  });
  registerTtsRoutes(app, {
    ttsService,
    rateLimiter: chatGenerationRateLimiter,
    userRepository,
    systemEventLogRepository,
  });
  registerAdminRoutes(app, { prisma, subscriptionService, systemEventLogRepository });

  app.get("/health", async (_req, reply) => {
    const db = await prisma
      .$queryRaw`SELECT 1`
      .then(() => ({ ok: true }))
      .catch((error: unknown) => ({
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

  app.get("/clock", async (_req, reply) => {
    return reply.status(200).send({
      ok: true,
      data: getBusinessClockSnapshot(),
    });
  });

  return app;
}

function resolveCorsAllowOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.CORS_ALLOW_ORIGINS?.trim();
  if (!raw) {
    return new Set();
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

class DisabledWeChatPaymentProvider implements PaymentProvider {
  readonly providerName = "wechat" as const;

  createOrder(_input: CreateProviderOrderInput): Promise<CreateProviderOrderResult> {
    throw new Error("WECHAT_PAY_DISABLED");
  }

  queryOrder(_input: QueryProviderOrderInput): Promise<QueryProviderOrderResult> {
    throw new Error("WECHAT_PAY_DISABLED");
  }
}
