import { PrismaClient } from "@prisma/client";
import { PrismaPaymentOrderRepository } from "./src/infrastructure/repository/PrismaPaymentOrderRepository.ts";
import { PrismaSubscriptionRepository } from "./src/infrastructure/repository/PrismaSubscriptionRepository.ts";
import { WeChatPaymentProvider } from "./src/providers/payment/WeChatPaymentProvider.ts";
import { PaymentOrderService } from "./src/services/payment/PaymentOrderService.ts";
import { SubscriptionService } from "./src/services/subscription/SubscriptionService.ts";
import { PaymentReconcileWorker } from "./src/workers/payment/PaymentReconcileWorker.ts";

const prisma = new PrismaClient();
const paymentOrderRepository = new PrismaPaymentOrderRepository(prisma);
const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
const paymentProvider = new WeChatPaymentProvider();
const paymentOrderService = new PaymentOrderService(paymentOrderRepository, paymentProvider);
const subscriptionService = new SubscriptionService(subscriptionRepository);
const worker = new PaymentReconcileWorker(paymentOrderService, subscriptionService);

console.log("[worker] payment reconcile worker running");
worker.start();

async function shutdown() {
  worker.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
