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
import { PrismaJournalRepository } from "./src/infrastructure/repository/PrismaJournalRepository.ts";
import { PrismaEntitlementRepository } from "./src/infrastructure/repository/PrismaEntitlementRepository.ts";
import { PrismaAiRequestLogRepository } from "./src/infrastructure/repository/PrismaAiRequestLogRepository.ts";
import { createAIProvider } from "./src/providers/ai/createAIProvider.ts";
import { JournalRewriteWorkerService } from "./src/services/journal/JournalRewriteWorkerService.ts";
import { JournalRewriteWorker } from "./src/workers/journal/JournalRewriteWorker.ts";
import { JournalImageCleanupWorker } from "./src/workers/journal/JournalImageCleanupWorker.ts";
import { JournalSpeechCleanupWorker } from "./src/workers/journal/JournalSpeechCleanupWorker.ts";
import { JournalImageStorageProvider } from "./src/providers/storage/JournalImageStorageProvider.ts";
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
const journalImageStorageProvider = new JournalImageStorageProvider();
const accountDeletionCleanupWorker = new AccountDeletionCleanupWorker(
  prisma,
  systemEventLogRepository,
  ttsStorageProvider,
  { googlePlayBillingService, imageStorageProvider: journalImageStorageProvider }
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
const journalRepository = new PrismaJournalRepository(prisma);
const entitlementRepository = new PrismaEntitlementRepository(prisma);
const entitlementService = new EntitlementService(entitlementRepository, subscriptionService);
const aiRequestLogRepository = new PrismaAiRequestLogRepository(prisma);
const workerRedisClient = getRedisClient();
const journalTaskGuard = workerRedisClient
  ? new RedisChatGenerationTaskGuard(workerRedisClient)
  : new InMemoryChatGenerationTaskGuard();
const journalTmsClient =
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
const journalContentSafetyService = new ContentSafetyService(systemEventLogRepository, {
  tencentTmsClient: journalTmsClient,
  tencentTmsEnabled: Boolean(journalTmsClient),
  tencentTmsBlockSuggestions: runtime.contentSafetyTencentBlockSuggestions,
  tencentTmsFailClosed: runtime.contentSafetyTencentFailClosed,
  tencentTmsReviewMode: runtime.contentSafetyTencentReviewMode,
});
const journalRewriteService = new JournalRewriteWorkerService(
  journalRepository,
  createAIProvider(runtime),
  entitlementService,
  journalTaskGuard,
  aiRequestLogRepository,
  systemEventLogRepository,
  journalContentSafetyService,
);
const journalRewriteWorker = new JournalRewriteWorker(journalRewriteService);
const journalImageCleanupWorker = new JournalImageCleanupWorker(
  journalRepository,
  journalImageStorageProvider,
);
const journalSpeechCleanupWorker = new JournalSpeechCleanupWorker(
  journalRepository,
  ttsStorageProvider,
);
const userAvatarCleanupWorker = new UserAvatarCleanupWorker(
  new PrismaUserProfileRepository(prisma),
  journalImageStorageProvider,
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

console.log("[worker] payment/grant/session/account-delete/log/ai/tts/cert/journal workers running");
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
  journalRewriteWorker.start();
  journalImageCleanupWorker.start();
  journalSpeechCleanupWorker.start();
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
  journalRewriteWorker.stop();
  journalImageCleanupWorker.stop();
  journalSpeechCleanupWorker.stop();
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
