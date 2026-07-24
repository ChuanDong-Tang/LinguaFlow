import { PrismaClient } from "@prisma/client";
import { PrismaPaymentOrderRepository } from "./src/infrastructure/repository/PrismaPaymentOrderRepository.ts";
import { PrismaPaymentEventRepository } from "./src/infrastructure/repository/PrismaPaymentEventRepository.ts";
import { PrismaBenefitGrantRepository } from "./src/infrastructure/repository/PrismaBenefitGrantRepository.ts";
import { PrismaSubscriptionRepository } from "./src/infrastructure/repository/PrismaSubscriptionRepository.ts";
import { PrismaGooglePlayAccountLinkRepository } from "./src/infrastructure/repository/PrismaGooglePlayAccountLinkRepository.ts";
import { WeChatPaymentProvider } from "./src/providers/payment/index.ts";
import { GooglePlayBillingService } from "./src/providers/payment/google/GooglePlayBillingService.ts";
import { PaymentOrderService } from "./src/services/payment/PaymentOrderService.ts";
import { PaymentEntitlementService } from "./src/services/payment/PaymentEntitlementService.ts";
import { BenefitGrantService } from "./src/services/payment/BenefitGrantService.ts";
import { SubscriptionService } from "./src/services/subscription/SubscriptionService.ts";
import { PaymentReconcileWorker } from "./src/workers/payment/PaymentReconcileWorker.ts";
import { BenefitGrantWorker } from "./src/workers/payment/BenefitGrantWorker.ts";
import { PrismaSystemEventLogRepository } from "./src/infrastructure/repository/PrismaSystemEventLogRepository.ts";
import { PrismaTrustedCertRepository } from "./src/infrastructure/repository/PrismaTrustedCertRepository.ts";
import { PrismaAutoRenewRepository } from "./src/infrastructure/repository/PrismaAutoRenewRepository.ts";
import { SessionCleanupWorker } from "./src/workers/session/SessionCleanupWorker.ts";
import { AccountDeletionCleanupWorker } from "./src/workers/auth/AccountDeletionCleanupWorker.ts";
import { SystemEventLogCleanupWorker } from "./src/workers/system/SystemEventLogCleanupWorker.ts";
import { AiRequestLogCleanupWorker } from "./src/workers/ai/AiRequestLogCleanupWorker.ts";
import { PaymentCertSyncWorker } from "./src/workers/payment/PaymentCertSyncWorker.ts";
import { WeChatAutoRenewBillingWorker } from "./src/workers/payment/WeChatAutoRenewBillingWorker.ts";
import { GooglePlayAcknowledgeWorker } from "./src/workers/payment/GooglePlayAcknowledgeWorker.ts";
import { GooglePlaySubscriptionReconcileWorker } from "./src/workers/payment/GooglePlaySubscriptionReconcileWorker.ts";
import { getRuntimeConfig } from "./src/config/runtimeConfig.ts";
import { getRedisClient } from "./src/infrastructure/redis/redisClient.ts";
import { AutoRenewService } from "./src/services/payment/AutoRenewService.ts";
import { WeChatAutoRenewProvider } from "./src/providers/payment/index.ts";
import { CosStorageProvider } from "./src/providers/storage/CosStorageProvider.ts";
import { TtsAssetCleanupWorker } from "./src/workers/tts/TtsAssetCleanupWorker.ts";
import { TtsRequestLogCleanupWorker } from "./src/workers/tts/TtsRequestLogCleanupWorker.ts";
import { PrismaCardRepository } from "./src/infrastructure/repository/PrismaCardRepository.ts";
import { PrismaCardEnrichmentRepository } from "./src/infrastructure/repository/PrismaCardEnrichmentRepository.ts";
import { PrismaEntitlementRepository } from "./src/infrastructure/repository/PrismaEntitlementRepository.ts";
import { PrismaAiRequestLogRepository } from "./src/infrastructure/repository/PrismaAiRequestLogRepository.ts";
import { createAIProvider } from "./src/providers/ai/createAIProvider.ts";
import { CardRewriteWorkerService } from "./src/services/card/CardRewriteWorkerService.ts";
import { CardRewriteWorker } from "./src/workers/card/CardRewriteWorker.ts";
import { SerialCardJobWorker } from "./src/workers/card/SerialCardJobWorker.ts";
import { RedisCardWorkerConcurrencyGuard } from "./src/workers/card/CardWorkerConcurrencyGuard.ts";
import { CardEnrichmentWorkerService } from "./src/services/card/CardEnrichmentWorkerService.ts";
import { AzureEmbeddingProvider } from "./src/providers/ai/AzureEmbeddingProvider.ts";
import { PhraseNormalizationWorkerService } from "./src/services/card/PhraseNormalizationWorkerService.ts";
import { PhraseHistoryIndexWorkerService } from "./src/services/card/PhraseHistoryIndexWorkerService.ts";
import { CardPhraseIndexWorkerService } from "./src/services/card/CardPhraseIndexWorkerService.ts";
import { ProgressPhraseDetectionService } from "./src/services/card/ProgressPhraseDetectionService.ts";
import { ProgressPhraseDetectionWorkerService } from "./src/services/card/ProgressPhraseDetectionWorkerService.ts";
import { CardImageCleanupWorker } from "./src/workers/card/CardImageCleanupWorker.ts";
import { CardSpeechCleanupWorker } from "./src/workers/card/CardSpeechCleanupWorker.ts";
import { CardImageStorageProvider } from "./src/providers/storage/CardImageStorageProvider.ts";
import { PrismaUserProfileRepository } from "./src/infrastructure/repository/PrismaUserProfileRepository.ts";
import { UserAvatarCleanupWorker } from "./src/workers/auth/UserAvatarCleanupWorker.ts";
import { EntitlementService } from "./src/services/entitlement/EntitlementService.ts";
import {
  InMemoryChatGenerationTaskGuard,
  RedisChatGenerationTaskGuard,
} from "./src/services/chat/ChatGenerationTaskGuard.ts";
import { ContentSafetyService } from "./src/services/contentSafety/ContentSafetyService.ts";
import { TencentTmsClient } from "./src/services/contentSafety/TencentTmsClient.ts";

const prisma = new PrismaClient();
const runtime = getRuntimeConfig();
const paymentOrderRepository = new PrismaPaymentOrderRepository(prisma);
const paymentEventRepository = new PrismaPaymentEventRepository(prisma);
const benefitGrantRepository = new PrismaBenefitGrantRepository(prisma);
const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
const googlePlayAccountLinkRepository = new PrismaGooglePlayAccountLinkRepository(prisma);
const systemEventLogRepository = new PrismaSystemEventLogRepository(prisma);
const trustedCertRepository = new PrismaTrustedCertRepository(prisma);
const autoRenewRepository = new PrismaAutoRenewRepository(prisma);
const paymentProvider = new WeChatPaymentProvider();
const subscriptionService = new SubscriptionService(subscriptionRepository);
const paymentOrderService = new PaymentOrderService(
  paymentOrderRepository,
  paymentProvider,
  subscriptionService
);
const paymentEntitlementService = new PaymentEntitlementService(
  subscriptionService,
  autoRenewRepository
);
const weChatAutoRenewProvider = new WeChatAutoRenewProvider();
const autoRenewService = new AutoRenewService(
  autoRenewRepository,
  paymentEntitlementService,
  weChatAutoRenewProvider,
  systemEventLogRepository,
  subscriptionService
);
const benefitGrantService = new BenefitGrantService(benefitGrantRepository);
const googlePlayBillingService = new GooglePlayBillingService(
  paymentEntitlementService,
  paymentOrderRepository,
  autoRenewService,
  paymentEventRepository,
  subscriptionRepository,
  benefitGrantService,
  googlePlayAccountLinkRepository
);
const worker = new PaymentReconcileWorker(
  paymentOrderService,
  benefitGrantService,
  paymentEntitlementService,
  systemEventLogRepository
);
const benefitGrantWorker = new BenefitGrantWorker(
  benefitGrantRepository,
  paymentEntitlementService,
  systemEventLogRepository
);
const sessionCleanupWorker = new SessionCleanupWorker(prisma, systemEventLogRepository);
const ttsStorageProvider = new CosStorageProvider();
const cardImageStorageProvider = new CardImageStorageProvider();
const accountDeletionCleanupWorker = new AccountDeletionCleanupWorker(
  prisma,
  systemEventLogRepository,
  ttsStorageProvider,
  { googlePlayBillingService, imageStorageProvider: cardImageStorageProvider }
);
const systemEventLogCleanupWorker = new SystemEventLogCleanupWorker(prisma, systemEventLogRepository);
const aiRequestLogCleanupWorker = new AiRequestLogCleanupWorker(prisma, systemEventLogRepository);
const ttsAssetCleanupWorker = new TtsAssetCleanupWorker(prisma, systemEventLogRepository);
const ttsRequestLogCleanupWorker = new TtsRequestLogCleanupWorker(prisma, systemEventLogRepository);
const paymentCertSyncWorker = new PaymentCertSyncWorker(
  trustedCertRepository,
  systemEventLogRepository
);
const weChatAutoRenewBillingWorker = new WeChatAutoRenewBillingWorker(
  autoRenewService,
  systemEventLogRepository
);
const googlePlayAcknowledgeWorker = new GooglePlayAcknowledgeWorker(
  prisma,
  googlePlayBillingService,
  systemEventLogRepository
);
const googlePlaySubscriptionReconcileWorker = new GooglePlaySubscriptionReconcileWorker(
  prisma,
  googlePlayBillingService,
  systemEventLogRepository
);
const cardRepository = new PrismaCardRepository(prisma);
const cardEnrichmentRepository = new PrismaCardEnrichmentRepository(prisma);
const entitlementRepository = new PrismaEntitlementRepository(prisma);
const entitlementService = new EntitlementService(entitlementRepository, subscriptionService);
const aiRequestLogRepository = new PrismaAiRequestLogRepository(prisma);
const cardAiProvider = createAIProvider(runtime);
const workerRedisClient = getRedisClient();
const cardTaskGuard = workerRedisClient
  ? new RedisChatGenerationTaskGuard(workerRedisClient)
  : new InMemoryChatGenerationTaskGuard();
const cardWorkerConcurrencyGuard = workerRedisClient
  ? new RedisCardWorkerConcurrencyGuard(workerRedisClient, runtime.cardWorkerConcurrencyLeaseMs)
  : undefined;
const cardTmsClient =
  runtime.contentSafetyTencentTmsEnabled &&
  runtime.contentSafetyTencentSecretId &&
  runtime.contentSafetyTencentSecretKey
    ? new TencentTmsClient({
        secretId: runtime.contentSafetyTencentSecretId,
        secretKey: runtime.contentSafetyTencentSecretKey,
        region: runtime.contentSafetyTencentRegion,
        bizType: runtime.contentSafetyTencentBizType,
        timeoutMs: runtime.contentSafetyTencentTimeoutMs,
      })
    : undefined;
const cardContentSafetyService = new ContentSafetyService(systemEventLogRepository, {
  tencentTmsClient: cardTmsClient,
  tencentTmsEnabled: Boolean(cardTmsClient),
  tencentTmsBlockSuggestions: runtime.contentSafetyTencentBlockSuggestions,
  tencentTmsFailClosed: runtime.contentSafetyTencentFailClosed,
  tencentTmsReviewMode: runtime.contentSafetyTencentReviewMode,
});
const cardRewriteService = new CardRewriteWorkerService(
  cardRepository,
  cardAiProvider,
  entitlementService,
  cardTaskGuard,
  aiRequestLogRepository,
  systemEventLogRepository,
  cardContentSafetyService,
);
const cardRewriteWorker = new CardRewriteWorker(cardRewriteService, {
  concurrencyGuard: cardWorkerConcurrencyGuard,
  concurrencyLimit: runtime.cardRewriteGlobalConcurrency,
});
const phraseNormalizationWorker = new SerialCardJobWorker(
  new PhraseNormalizationWorkerService(cardEnrichmentRepository, cardAiProvider),
  {
    workerIdPrefix: "phrase-normalization",
    errorLabel: "phrase-normalization-worker",
    concurrencyGuard: cardWorkerConcurrencyGuard,
    concurrencyScope: "phrase-normalization",
    concurrencyLimit: runtime.cardPhraseNormalizationGlobalConcurrency,
  },
);
const phraseHistoryIndexWorker = new SerialCardJobWorker(
  new PhraseHistoryIndexWorkerService(cardEnrichmentRepository),
  {
    workerIdPrefix: "phrase-history",
    errorLabel: "phrase-history-worker",
    concurrencyGuard: cardWorkerConcurrencyGuard,
    concurrencyScope: "phrase-history",
    concurrencyLimit: runtime.cardPhraseHistoryGlobalConcurrency,
  },
);
const cardPhraseIndexWorker = new SerialCardJobWorker(
  new CardPhraseIndexWorkerService(cardEnrichmentRepository),
  {
    workerIdPrefix: "card-phrase-index",
    errorLabel: "card-phrase-index-worker",
    concurrencyGuard: cardWorkerConcurrencyGuard,
    concurrencyScope: "phrase-index",
    concurrencyLimit: runtime.cardPhraseIndexGlobalConcurrency,
  },
);
const progressPhraseDetectionWorker = new SerialCardJobWorker(
  new ProgressPhraseDetectionWorkerService(
    cardEnrichmentRepository,
    new ProgressPhraseDetectionService(cardAiProvider),
  ),
  {
    workerIdPrefix: "progress-phrase",
    errorLabel: "progress-phrase-worker",
    concurrencyGuard: cardWorkerConcurrencyGuard,
    concurrencyScope: "progress-detection",
    concurrencyLimit: runtime.cardProgressDetectionGlobalConcurrency,
  },
);
const embeddingConfigValues = [
  runtime.azureEmbeddingEndpoint,
  runtime.azureEmbeddingApiKey,
  runtime.azureEmbeddingDeployment,
];
const hasAnyEmbeddingConfig = embeddingConfigValues.some(Boolean);
const hasCompleteEmbeddingConfig = embeddingConfigValues.every(Boolean);
if (hasAnyEmbeddingConfig && !hasCompleteEmbeddingConfig) {
  throw new Error("AZURE_EMBEDDING_CONFIG_INCOMPLETE");
}
if (runtime.isProduction && runtime.cardEnabled && !hasCompleteEmbeddingConfig) {
  throw new Error("AZURE_EMBEDDING_CONFIG_REQUIRED");
}
const cardEnrichmentWorker = hasCompleteEmbeddingConfig
  ? new SerialCardJobWorker(
      new CardEnrichmentWorkerService(
        cardEnrichmentRepository,
        new AzureEmbeddingProvider({
          endpoint: runtime.azureEmbeddingEndpoint,
          apiKey: runtime.azureEmbeddingApiKey,
          deployment: runtime.azureEmbeddingDeployment,
          apiVersion: runtime.azureEmbeddingApiVersion,
          model: runtime.azureEmbeddingModel,
          dimensions: runtime.azureEmbeddingDimensions,
          timeoutMs: runtime.azureEmbeddingTimeoutMs,
        }),
        systemEventLogRepository,
      ),
      {
        workerIdPrefix: "card-enrichment",
        errorLabel: "card-enrichment-worker",
        concurrencyGuard: cardWorkerConcurrencyGuard,
        concurrencyScope: "embedding",
        concurrencyLimit: runtime.cardEmbeddingGlobalConcurrency,
      },
    )
  : null;
const cardImageCleanupWorker = new CardImageCleanupWorker(
  cardRepository,
  cardImageStorageProvider,
);
const cardSpeechCleanupWorker = new CardSpeechCleanupWorker(
  cardRepository,
  ttsStorageProvider,
);
const userAvatarCleanupWorker = new UserAvatarCleanupWorker(
  new PrismaUserProfileRepository(prisma),
  cardImageStorageProvider,
);

let shuttingDown = false;

if (runtime.requireRedis) {
  const redisClient = getRedisClient();
  try {
    const pong = await redisClient.ping();
    if (pong !== "PONG") throw new Error(`unexpected ping result: ${pong}`);
  } catch (error) {
    console.error("[worker] startup failed: Redis unavailable", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

console.log("[worker] payment/grant/session/account-delete/log/ai/tts/cert/card workers running");
try {
  worker.start();
  benefitGrantWorker.start();
  sessionCleanupWorker.start();
  accountDeletionCleanupWorker.start();
  systemEventLogCleanupWorker.start();
  aiRequestLogCleanupWorker.start();
  ttsAssetCleanupWorker.start();
  ttsRequestLogCleanupWorker.start();
  paymentCertSyncWorker.start();
  weChatAutoRenewBillingWorker.start();
  googlePlayAcknowledgeWorker.start();
  googlePlaySubscriptionReconcileWorker.start();
  cardRewriteWorker.start();
  cardEnrichmentWorker?.start();
  phraseNormalizationWorker.start();
  phraseHistoryIndexWorker.start();
  cardPhraseIndexWorker.start();
  progressPhraseDetectionWorker.start();
  cardImageCleanupWorker.start();
  cardSpeechCleanupWorker.start();
  userAvatarCleanupWorker.start();
} catch (error) {
  console.error("[worker] start failed", error);
  await systemEventLogRepository.create({
    module: "payment",
    event: "payment.worker.start_failed",
    level: "error",
    status: "failed",
    errorCode: "WORKER_START_FAILED",
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  await prisma.$disconnect();
  process.exit(1);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  worker.stop();
  benefitGrantWorker.stop();
  sessionCleanupWorker.stop();
  accountDeletionCleanupWorker.stop();
  systemEventLogCleanupWorker.stop();
  aiRequestLogCleanupWorker.stop();
  ttsAssetCleanupWorker.stop();
  ttsRequestLogCleanupWorker.stop();
  paymentCertSyncWorker.stop();
  weChatAutoRenewBillingWorker.stop();
  googlePlayAcknowledgeWorker.stop();
  googlePlaySubscriptionReconcileWorker.stop();
  cardRewriteWorker.stop();
  cardEnrichmentWorker?.stop();
  phraseNormalizationWorker.stop();
  phraseHistoryIndexWorker.stop();
  cardPhraseIndexWorker.stop();
  progressPhraseDetectionWorker.stop();
  cardImageCleanupWorker.stop();
  cardSpeechCleanupWorker.stop();
  userAvatarCleanupWorker.stop();
  await prisma.$disconnect();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

// 全局未捕获异常兜底：统一记录、统一关闭，避免部分 worker 静默停摆
process.on("unhandledRejection", (reason) => {
  void handleFatal("UNHANDLED_REJECTION", reason);
});

process.on("uncaughtException", (error) => {
  void handleFatal("UNCAUGHT_EXCEPTION", error);
});

async function handleFatal(kind, error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[worker] ${kind}`, error);
  try {
    await systemEventLogRepository.create({
      module: "infra",
      event: "infra.worker.process_fatal",
      level: "error",
      status: "failed",
      errorCode: kind,
      errorMessage,
      metadata: {
        kind,
        at: new Date().toISOString(),
      },
    });
  } catch (logError) {
    console.error("[worker] write fatal system_event_log failed", logError);
  }
  await shutdown();
  process.exit(1);
}
