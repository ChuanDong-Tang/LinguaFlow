import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { MockAuthProvider } from "@lf/core/ports/auth/MockAuthProvider.js";
import { PrismaUserRepository } from "@lf/server/infrastructure/repository/PrismaUserRepository.js";
import { PrismaUserProfileRepository } from "@lf/server/infrastructure/repository/PrismaUserProfileRepository.js";
import { PrismaCardRepository } from "@lf/server/infrastructure/repository/PrismaCardRepository.js";
import { PrismaUserPreferenceRepository } from "@lf/server/infrastructure/repository/PrismaUserPreferenceRepository.js";
import { PrismaDictionaryLookupCacheRepository } from "@lf/server/infrastructure/repository/PrismaDictionaryLookupCacheRepository.js";
import { PrismaUserSessionRepository } from "@lf/server/infrastructure/repository/PrismaUserSessionRepository.js";
import { PrismaTtsAssetRepository } from "@lf/server/infrastructure/repository/PrismaTtsAssetRepository.js";
import { PrismaTtsRequestLogRepository } from "@lf/server/infrastructure/repository/PrismaTtsRequestLogRepository.js";
import { PrismaSttRequestLogRepository } from "@lf/server/infrastructure/repository/PrismaSttRequestLogRepository.js";
import { AuthLoginService } from "@lf/server/services/auth/AuthLoginService.js";
import { AccountDeletionService } from "@lf/server/services/auth/AccountDeletionService.js";
import { AccountEmailBindingService } from "@lf/server/services/auth/AccountEmailBindingService.js";
import { UserProfileService } from "@lf/server/services/auth/UserProfileService.js";
import { UserAvatarService } from "@lf/server/services/auth/UserAvatarService.js";
import { CardService } from "@lf/server/services/card/CardService.js";
import { CardSpeechService } from "@lf/server/services/card/CardSpeechService.js";
import { CardImageService } from "@lf/server/services/card/CardImageService.js";
import { AzureEmbeddingProvider } from "@lf/server/providers/ai/AzureEmbeddingProvider.js";
import { PrismaCardRelationRepository } from "@lf/server/infrastructure/repository/PrismaCardRelationRepository.js";
import { CardRelationService } from "@lf/server/services/card/CardRelationService.js";
import { PrismaCardCollectionRepository } from "@lf/server/infrastructure/repository/PrismaCardCollectionRepository.js";
import { CardCollectionService } from "@lf/server/services/card/CardCollectionService.js";
import { PrismaRecallRepository } from "@lf/server/infrastructure/repository/PrismaRecallRepository.js";
import { RecallService } from "@lf/server/services/card/RecallService.js";
import { CardImageStorageProvider } from "@lf/server/providers/storage/CardImageStorageProvider.js";
import { TencentImsClient } from "@lf/server/services/contentSafety/TencentImsClient.js";
import { registerCardRoutes } from "./card/routes.js";
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
import { UsageV2Service } from "@lf/server/services/usage/UsageV2Service.js";
import { SubscriptionService } from "@lf/server/services/subscription/SubscriptionService.js";
import { PaymentOrderService } from "@lf/server/services/payment/PaymentOrderService.js";
import { PaymentNotifyService } from "@lf/server/services/payment/PaymentNotifyService.js";
import { AppleIapService } from "@lf/server/providers/payment/apple/AppleIapService.js";
import { GooglePlayBillingService } from "@lf/server/providers/payment/google/GooglePlayBillingService.js";
import { PaymentEntitlementService } from "@lf/server/services/payment/PaymentEntitlementService.js";
import { BenefitGrantService } from "@lf/server/services/payment/BenefitGrantService.js";
import { WeChatPaymentProvider } from "@lf/server/providers/payment/wechat/WeChatPaymentProvider.js";
import { WeChatAutoRenewProvider } from "@lf/server/providers/payment/wechat/WeChatAutoRenewProvider.js";
import { PrismaAiRequestLogRepository } from "@lf/server/infrastructure/repository/PrismaAiRequestLogRepository.js";
import { PrismaSystemEventLogRepository } from "@lf/server/infrastructure/repository/PrismaSystemEventLogRepository.js";
import { PrismaTrustedCertRepository } from "@lf/server/infrastructure/repository/PrismaTrustedCertRepository.js";
import { PrismaAutoRenewRepository } from "@lf/server/infrastructure/repository/PrismaAutoRenewRepository.js";
import { PrismaAppleIapAccountLinkRepository } from "@lf/server/infrastructure/repository/PrismaAppleIapAccountLinkRepository.js";
import { PrismaGooglePlayAccountLinkRepository } from "@lf/server/infrastructure/repository/PrismaGooglePlayAccountLinkRepository.js";
import {
  InMemoryChatGenerationRateLimiter,
  RedisChatGenerationRateLimiter,
} from "@lf/server/services/chat/ChatGenerationRateLimiter.js";
import { registerMeRoutes } from "./me/routes.js";
import { registerPaymentRoutes } from "./payment/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { registerTtsRoutes } from "./tts/routes.js";
import { registerDictionaryRoutes } from "./dictionary/routes.js";
import { registerSttRoutes } from "./stt/routes.js";
import { registerAppVersionRoutes } from "./appVersion/routes.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";
import { ResourceGovernor } from "@lf/server/services/resource/ResourceGovernor.js";
import { writeSystemEventLog } from "./lib/systemEventLog.js";
import { PaymentCertSyncService } from "@lf/server/services/payment/PaymentCertSyncService.js";
import { AutoRenewService } from "@lf/server/services/payment/AutoRenewService.js";
import { PaymentEntitlementRefreshService } from "@lf/server/services/payment/PaymentEntitlementRefreshService.js";
import { getBusinessClockSnapshot } from "@lf/server/services/time/businessClock.js";
import { TtsService } from "@lf/server/services/tts/TtsService.js";
import { TtsStreamingCoordinator } from "@lf/server/services/tts/TtsStreamingCoordinator.js";
import { AzureGlobalTtsProvider } from "@lf/server/providers/tts/AzureGlobalTtsProvider.js";
import { SttService } from "@lf/server/services/stt/SttService.js";
import { AzureGlobalSttProvider } from "@lf/server/providers/stt/AzureGlobalSttProvider.js";
import { CosStorageProvider } from "@lf/server/providers/storage/CosStorageProvider.js";
import { ContentSafetyService } from "@lf/server/services/contentSafety/ContentSafetyService.js";
import { TencentTmsClient } from "@lf/server/services/contentSafety/TencentTmsClient.js";
import { ApiRequestMetrics, resolveApiSlowRequestThresholdMs } from "@lf/server/services/observability/ApiRequestMetrics.js";
import { DatabaseQueryMetrics } from "@lf/server/services/observability/DatabaseQueryMetrics.js";
import websocket from "@fastify/websocket";
import type {
  CreateProviderOrderInput,
  CreateProviderOrderResult,
  PaymentProvider,
  QueryProviderOrderInput,
  QueryProviderOrderResult,
} from "@lf/core/ports/payment/index.js";

const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
  ],
});
const databaseQueryMetrics = new DatabaseQueryMetrics(getRedisClient());
prisma.$on("query", (event) => {
  void databaseQueryMetrics.observeQuery({ query: event.query, durationMs: event.duration }).catch(() => undefined);
});
prisma.$on("error", () => {
  void databaseQueryMetrics.observeError().catch(() => undefined);
});

export function createApp() {
  const app = Fastify({ logger: true, trustProxy: true });
  const slowRequestThresholdMs = resolvePositiveInteger(process.env.LF_API_SLOW_REQUEST_MS, 1_000);
  void app.register(websocket);
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
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id, x-lf-usage-api");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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
  const userProfileRepository = new PrismaUserProfileRepository(prisma);
  const cardRepository = new PrismaCardRepository(prisma);
  const userPreferenceRepository = new PrismaUserPreferenceRepository(prisma);
  const dictionaryLookupCacheRepository = new PrismaDictionaryLookupCacheRepository(prisma);
  const userSessionRepository = new PrismaUserSessionRepository(prisma);
  const ttsAssetRepository = new PrismaTtsAssetRepository(prisma);
  const ttsRequestLogRepository = new PrismaTtsRequestLogRepository(prisma);
  const sttRequestLogRepository = new PrismaSttRequestLogRepository(prisma);
  const authLoginService = new AuthLoginService(userRepository, userSessionRepository);
  const accountDeletionService = new AccountDeletionService(userRepository, userSessionRepository);
  const accountEmailBindingService = new AccountEmailBindingService(userRepository);
  const runtimeConfig = getRuntimeConfig();
  const aiProvider = createAIProvider(runtimeConfig);
  const embeddingConfigValues = [
    runtimeConfig.azureEmbeddingEndpoint,
    runtimeConfig.azureEmbeddingApiKey,
    runtimeConfig.azureEmbeddingDeployment,
  ];
  const hasAnyEmbeddingConfig = embeddingConfigValues.some(Boolean);
  const hasCompleteEmbeddingConfig = embeddingConfigValues.every(Boolean);
  if (hasAnyEmbeddingConfig && !hasCompleteEmbeddingConfig) throw new Error("AZURE_EMBEDDING_CONFIG_INCOMPLETE");
  if (runtimeConfig.isProduction && runtimeConfig.cardEnabled && !hasCompleteEmbeddingConfig) {
    throw new Error("AZURE_EMBEDDING_CONFIG_REQUIRED");
  }
  const embeddingProvider = hasCompleteEmbeddingConfig
    ? new AzureEmbeddingProvider({
        endpoint: runtimeConfig.azureEmbeddingEndpoint!,
        apiKey: runtimeConfig.azureEmbeddingApiKey!,
        deployment: runtimeConfig.azureEmbeddingDeployment!,
        apiVersion: runtimeConfig.azureEmbeddingApiVersion,
        model: runtimeConfig.azureEmbeddingModel,
        dimensions: runtimeConfig.azureEmbeddingDimensions,
        timeoutMs: runtimeConfig.azureEmbeddingTimeoutMs,
      })
    : undefined;
  const cardRelationRepository = new PrismaCardRelationRepository(prisma);
  const conversationRepository = new PrismaConversationRepository(prisma);
  const messageRepository = new PrismaMessageRepository(prisma);
  const chatMessageService = new ChatMessageService(conversationRepository, messageRepository);
  const redisClient = getRedisClient();
  const apiRequestMetrics = new ApiRequestMetrics(redisClient, slowRequestThresholdMs);
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url;
    if (!route || route === "/health" || route === "/tts/stream/:generationId" || req.headers.upgrade === "websocket") return;
    const durationMs = Math.round(reply.elapsedTime * 10) / 10;
    const isServerError = reply.statusCode >= 500;
    void apiRequestMetrics.observe({
      route,
      method: req.method,
      statusCode: reply.statusCode,
      durationMs,
    }).catch((error) => req.log.warn({ err: error }, "api request metrics write failed"));
    const routeSlowThresholdMs = resolveApiSlowRequestThresholdMs(req.method, route, slowRequestThresholdMs);
    if (!isServerError && durationMs < routeSlowThresholdMs) return;

    req.log.warn({
      requestId: firstHeaderValue(req.headers["x-request-id"]) ?? req.id,
      route,
      method: req.method,
      statusCode: reply.statusCode,
      durationMs,
      slowRequestThresholdMs: routeSlowThresholdMs,
    }, isServerError ? "api request failed" : "slow api request");
  });
  const chatGenerationTaskGuard = redisClient
    ? new RedisChatGenerationTaskGuard(redisClient)
    : new InMemoryChatGenerationTaskGuard();
  const chatGenerationRateLimiter = redisClient
    ? new RedisChatGenerationRateLimiter(redisClient)
    : new InMemoryChatGenerationRateLimiter();
  const systemEventLogRepository = new PrismaSystemEventLogRepository(prisma);
  const resourceGovernor = new ResourceGovernor(runtimeConfig.resourcePolicies, redisClient, async (event) => {
    await writeSystemEventLog(systemEventLogRepository, {
      requestId: event.requestId ?? null,
      userId: event.userId,
      module: "resource",
      event: "resource.rate_limited",
      level: "warn",
      status: "failed",
      errorCode: "RESOURCE_LIMITED",
      errorMessage: `${event.resource} resource is temporarily limited`,
      metadata: {
        resource: event.resource,
        scope: event.scope,
        retryAfterMs: event.retryAfterMs,
        operation: event.operation ?? null,
      },
    });
  });
  if (runtimeConfig.requireRedis) {
    app.addHook("onReady", async () => {
      const pong = await redisClient!.ping();
      if (pong !== "PONG") throw new Error("REDIS_STARTUP_CHECK_FAILED");
    });
  }
  const entitlementRepository = new PrismaEntitlementRepository(prisma);
  const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
  const subscriptionService = new SubscriptionService(subscriptionRepository);
  const entitlementService = new EntitlementService(entitlementRepository, subscriptionService);
  const usageV2Service = new UsageV2Service(prisma, subscriptionService);
  const paymentOrderRepository = new PrismaPaymentOrderRepository(prisma);
  const paymentEventRepository = new PrismaPaymentEventRepository(prisma);
  const benefitGrantRepository = new PrismaBenefitGrantRepository(prisma);
  const tencentTmsClient =
    runtimeConfig.contentSafetyTencentTmsEnabled &&
    runtimeConfig.contentSafetyTencentSecretId &&
    runtimeConfig.contentSafetyTencentSecretKey
      ? new TencentTmsClient({
          secretId: runtimeConfig.contentSafetyTencentSecretId,
          secretKey: runtimeConfig.contentSafetyTencentSecretKey,
          region: runtimeConfig.contentSafetyTencentRegion,
          bizType: runtimeConfig.contentSafetyTencentBizType,
          timeoutMs: runtimeConfig.contentSafetyTencentTimeoutMs,
        })
      : undefined;
  const contentSafetyService = new ContentSafetyService(systemEventLogRepository, {
    tencentTmsClient,
    tencentTmsEnabled: Boolean(tencentTmsClient),
    tencentTmsBlockSuggestions: runtimeConfig.contentSafetyTencentBlockSuggestions,
    tencentTmsFailClosed: runtimeConfig.contentSafetyTencentFailClosed,
    tencentTmsReviewMode: runtimeConfig.contentSafetyTencentReviewMode,
  });
  const tencentImsClient = runtimeConfig.contentSafetyTencentSecretId && runtimeConfig.contentSafetyTencentSecretKey
    ? new TencentImsClient({
        secretId: runtimeConfig.contentSafetyTencentSecretId,
        secretKey: runtimeConfig.contentSafetyTencentSecretKey,
        region: runtimeConfig.contentSafetyTencentRegion,
        bizType: process.env.TENCENT_IMS_BIZ_TYPE?.trim() || null,
        timeoutMs: Number(process.env.TENCENT_IMS_TIMEOUT_MS ?? 8_000),
      })
    : undefined;
  const imageStorageProvider = new CardImageStorageProvider();
  const userProfileService = new UserProfileService(
    userProfileRepository,
    tencentTmsClient,
    systemEventLogRepository,
    imageStorageProvider,
  );
  const userAvatarService = new UserAvatarService(
    userProfileRepository,
    imageStorageProvider,
    tencentImsClient,
    systemEventLogRepository,
  );
  const cardImageService = new CardImageService(
    cardRepository,
    imageStorageProvider,
    tencentImsClient,
    systemEventLogRepository,
    entitlementService,
    usageV2Service,
  );
  const cardRelationService = new CardRelationService(
    cardRelationRepository,
    {
      modelVersion: embeddingProvider?.modelVersion ?? null,
      minTopicSimilarity: runtimeConfig.relatedTopicMinSimilarity,
    },
    cardImageService,
  );
  const trustedCertRepository = new PrismaTrustedCertRepository(prisma);
  const autoRenewRepository = new PrismaAutoRenewRepository(prisma);
  const appleIapAccountLinkRepository = new PrismaAppleIapAccountLinkRepository(prisma);
  const googlePlayAccountLinkRepository = new PrismaGooglePlayAccountLinkRepository(prisma);
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
    subscriptionService,
    subscriptionRepository
  );
  const googlePlayBillingService = new GooglePlayBillingService(
    paymentEntitlementService,
    paymentOrderRepository,
    autoRenewService,
    paymentEventRepository,
    subscriptionRepository,
    benefitGrantService,
    googlePlayAccountLinkRepository
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
    userPreferenceRepository,
    contentSafetyService,
    cardRepository,
    resourceGovernor,
    usageV2Service,
  );
  const cardService = new CardService(
    cardRepository,
    userPreferenceRepository,
    entitlementService,
    chatGenerationTaskGuard,
    runtimeConfig.chatGenerationTaskTtlMs,
    contentSafetyService,
    cardImageService,
    aiProvider,
    resourceGovernor,
    runtimeConfig.cardListPageSizeMax,
    {
      titleMaxChars: runtimeConfig.cardTitleMaxChars,
      topicMaxChars: runtimeConfig.cardTopicMaxChars,
      contentMaxChars: runtimeConfig.cardContentMaxChars,
      imagesMaxPerCard: runtimeConfig.cardImagesMaxPerCard,
    },
    usageV2Service,
  );
  const cardCollectionService = new CardCollectionService(new PrismaCardCollectionRepository(prisma));
  const recallService = new RecallService(
    new PrismaRecallRepository(prisma),
    cardRelationService,
    embeddingProvider,
    cardImageService,
    resourceGovernor,
    runtimeConfig.recallExplorationNodeLimit,
    runtimeConfig.recallSearchResultLimit,
    runtimeConfig.recallSemanticMinScore,
  );
  const ttsProvider = new AzureGlobalTtsProvider();
  const ttsStorageProvider = new CosStorageProvider();
  const ttsService = new TtsService(
    messageRepository,
    userPreferenceRepository,
    ttsAssetRepository,
    entitlementService,
    ttsProvider,
    ttsStorageProvider,
    ttsRequestLogRepository,
    redisClient,
    resourceGovernor,
  );
  const cardSpeechService = new CardSpeechService(
    cardRepository,
    userPreferenceRepository,
    entitlementService,
    ttsProvider,
    ttsStorageProvider,
    redisClient,
    resourceGovernor,
    runtimeConfig.cardContentMaxChars,
  );
  const ttsStreamingEnabled = process.env.TTS_STREAMING_ENABLED?.trim().toLowerCase() === "true";
  const ttsStreamingTicketSecret = process.env.TTS_STREAMING_TICKET_SECRET?.trim() ?? "";
  if (ttsStreamingEnabled && !redisClient) throw new Error("TTS_STREAMING_REDIS_REQUIRED");
  if (ttsStreamingEnabled && !ttsStreamingTicketSecret) throw new Error("TTS_STREAMING_TICKET_SECRET_REQUIRED");
  const ttsStreamingCoordinator = ttsStreamingEnabled
    ? new TtsStreamingCoordinator(redisClient!, { ticketSecret: ttsStreamingTicketSecret })
    : undefined;
  const sttService = new SttService(new AzureGlobalSttProvider());

  app.after((error) => {
    if (error) throw error;

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
      accountEmailBindingService,
      userRepository,
      systemEventLogRepository,
    });
    registerChatRoutes(app, {
      chatMessageService,
      cardService,
      userRepository,
      systemEventLogRepository,
      contentSafetyService,
      entitlementService,
      rateLimiter: chatGenerationRateLimiter,
    });
    registerCardRoutes(app, {
      cardService,
      cardImageService,
      cardCollectionService,
      recallService,
      cardRelationService,
      cardEnabled: runtimeConfig.cardEnabled,
      rateLimiter: chatGenerationRateLimiter,
      userRepository,
      systemEventLogRepository,
    });
    registerMeRoutes(app, {
      subscriptionService,
      entitlementService,
      usageV2Service,
      paymentEntitlementRefreshService,
      userPreferenceRepository,
      userProfileService,
      userAvatarService,
      profileRateLimiter: chatGenerationRateLimiter,
      userRepository,
      systemEventLogRepository,
    });
    registerPaymentRoutes(app, {
      paymentOrderService,
      paymentNotifyService,
      autoRenewService,
      appleIapService,
      googlePlayBillingService,
      userRepository,
      systemEventLogRepository,
    });
    registerTtsRoutes(app, {
      ttsService,
      cardSpeechService,
      ttsStreamingCoordinator,
      rateLimiter: chatGenerationRateLimiter,
      resourceGovernor,
      userRepository,
      systemEventLogRepository,
    });
    registerDictionaryRoutes(app, {
      aiProvider,
      userPreferenceRepository,
      cacheRepository: dictionaryLookupCacheRepository,
      usageV2Service,
      rateLimiter: chatGenerationRateLimiter,
      userRepository,
      systemEventLogRepository,
    });
    registerSttRoutes(app, {
      sttService,
      rateLimiter: chatGenerationRateLimiter,
      resourceGovernor,
      userRepository,
      sttRequestLogRepository,
      systemEventLogRepository,
    });
    registerAppVersionRoutes(app);
    registerAdminRoutes(app, { prisma, subscriptionService, systemEventLogRepository, resourceGovernor, apiRequestMetrics, databaseQueryMetrics, ttsStreamingCoordinator });

    app.get("/health", async (req, reply) => {
      const [db, redis] = await Promise.all([
        prisma
          .$queryRaw`SELECT 1`
          .then(() => ({ ok: true }))
          .catch((error: unknown) => {
            req.log.error({ err: error, component: "db" }, "health dependency check failed");
            return { ok: false };
          }),
        redisClient
          ? redisClient
              .ping()
              .then(() => ({ ok: true }))
              .catch((error: unknown) => {
                req.log.error({ err: error, component: "redis" }, "health dependency check failed");
                return { ok: false };
              })
          : Promise.resolve({ ok: true, skipped: true }),
      ]);
      const ok = db.ok && redis.ok;

      reply.header("Cache-Control", "no-store");
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

function resolvePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
