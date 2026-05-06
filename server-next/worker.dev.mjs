import { PrismaClient } from "@prisma/client";
import { PrismaPaymentOrderRepository } from "./src/infrastructure/repository/PrismaPaymentOrderRepository.ts";
import { PrismaSubscriptionRepository } from "./src/infrastructure/repository/PrismaSubscriptionRepository.ts";
import { WeChatPaymentProvider } from "./src/providers/payment/index.ts";
import { PaymentOrderService } from "./src/services/payment/PaymentOrderService.ts";
import { PaymentEntitlementService } from "./src/services/payment/PaymentEntitlementService.ts";
import { SubscriptionService } from "./src/services/subscription/SubscriptionService.ts";
import { PaymentReconcileWorker } from "./src/workers/payment/PaymentReconcileWorker.ts";
import { PrismaSystemEventLogRepository } from "./src/infrastructure/repository/PrismaSystemEventLogRepository.ts";
import { SessionCleanupWorker } from "./src/workers/session/SessionCleanupWorker.ts";
import { SystemEventLogCleanupWorker } from "./src/workers/system/SystemEventLogCleanupWorker.ts";
import { AiRequestLogCleanupWorker } from "./src/workers/ai/AiRequestLogCleanupWorker.ts";

const prisma = new PrismaClient();
const paymentOrderRepository = new PrismaPaymentOrderRepository(prisma);
const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
const systemEventLogRepository = new PrismaSystemEventLogRepository(prisma);
const paymentProvider = new WeChatPaymentProvider();
const paymentOrderService = new PaymentOrderService(paymentOrderRepository, paymentProvider);
const subscriptionService = new SubscriptionService(subscriptionRepository);
const paymentEntitlementService = new PaymentEntitlementService(subscriptionService);
const worker = new PaymentReconcileWorker(
  paymentOrderService,
  paymentEntitlementService,
  systemEventLogRepository
);
const sessionCleanupWorker = new SessionCleanupWorker(prisma, systemEventLogRepository);
const systemEventLogCleanupWorker = new SystemEventLogCleanupWorker(prisma, systemEventLogRepository);
const aiRequestLogCleanupWorker = new AiRequestLogCleanupWorker(prisma, systemEventLogRepository);

console.log("[worker] payment/session/log/ai cleanup workers running");
try {
  worker.start();
  sessionCleanupWorker.start();
  systemEventLogCleanupWorker.start();
  aiRequestLogCleanupWorker.start();
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
  worker.stop();
  sessionCleanupWorker.stop();
  systemEventLogCleanupWorker.stop();
  aiRequestLogCleanupWorker.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
