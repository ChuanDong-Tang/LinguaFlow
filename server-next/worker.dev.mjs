import { PrismaClient } from "@prisma/client";
import { PrismaPaymentOrderRepository } from "./src/infrastructure/repository/PrismaPaymentOrderRepository.ts";
import { PrismaBenefitGrantRepository } from "./src/infrastructure/repository/PrismaBenefitGrantRepository.ts";
import { PrismaSubscriptionRepository } from "./src/infrastructure/repository/PrismaSubscriptionRepository.ts";
import { WeChatPaymentProvider } from "./src/providers/payment/index.ts";
import { PaymentOrderService } from "./src/services/payment/PaymentOrderService.ts";
import { PaymentEntitlementService } from "./src/services/payment/PaymentEntitlementService.ts";
import { BenefitGrantService } from "./src/services/payment/BenefitGrantService.ts";
import { SubscriptionService } from "./src/services/subscription/SubscriptionService.ts";
import { PaymentReconcileWorker } from "./src/workers/payment/PaymentReconcileWorker.ts";
import { BenefitGrantWorker } from "./src/workers/payment/BenefitGrantWorker.ts";
import { PrismaSystemEventLogRepository } from "./src/infrastructure/repository/PrismaSystemEventLogRepository.ts";
import { PrismaTrustedCertRepository } from "./src/infrastructure/repository/PrismaTrustedCertRepository.ts";
import { SessionCleanupWorker } from "./src/workers/session/SessionCleanupWorker.ts";
import { SystemEventLogCleanupWorker } from "./src/workers/system/SystemEventLogCleanupWorker.ts";
import { AiRequestLogCleanupWorker } from "./src/workers/ai/AiRequestLogCleanupWorker.ts";
import { PaymentCertSyncWorker } from "./src/workers/payment/PaymentCertSyncWorker.ts";
import { getRuntimeConfig } from "./src/config/runtimeConfig.ts";
import { getRedisClient } from "./src/infrastructure/redis/redisClient.ts";

const prisma = new PrismaClient();
const paymentOrderRepository = new PrismaPaymentOrderRepository(prisma);
const benefitGrantRepository = new PrismaBenefitGrantRepository(prisma);
const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
const systemEventLogRepository = new PrismaSystemEventLogRepository(prisma);
const trustedCertRepository = new PrismaTrustedCertRepository(prisma);
const paymentProvider = new WeChatPaymentProvider();
const paymentOrderService = new PaymentOrderService(paymentOrderRepository, paymentProvider);
const subscriptionService = new SubscriptionService(subscriptionRepository);
const paymentEntitlementService = new PaymentEntitlementService(subscriptionService);
const benefitGrantService = new BenefitGrantService(benefitGrantRepository);
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
const systemEventLogCleanupWorker = new SystemEventLogCleanupWorker(prisma, systemEventLogRepository);
const aiRequestLogCleanupWorker = new AiRequestLogCleanupWorker(prisma, systemEventLogRepository);
const paymentCertSyncWorker = new PaymentCertSyncWorker(
  trustedCertRepository,
  systemEventLogRepository
);

const runtime = getRuntimeConfig();
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

console.log("[worker] payment/grant/session/log/ai/cert workers running");
try {
  worker.start();
  benefitGrantWorker.start();
  sessionCleanupWorker.start();
  systemEventLogCleanupWorker.start();
  aiRequestLogCleanupWorker.start();
  paymentCertSyncWorker.start();
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
  systemEventLogCleanupWorker.stop();
  aiRequestLogCleanupWorker.stop();
  paymentCertSyncWorker.stop();
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
