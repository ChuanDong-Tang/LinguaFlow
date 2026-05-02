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


// 创建 HTTP 服务实例，后续所有接口都挂在 app 上
const app = Fastify({ logger: true });

// 实例化登录 provider：后面可替换成 CNAuthProvider
const authProvider = new MockAuthProvider();
const prisma = new PrismaClient();
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
//redis
const redisClient = getRedisClient();
if (!redisClient && process.env.NODE_ENV === "production") {
  throw new Error("REDIS_URL is required in production.");
}
const rewriteTaskGuard = redisClient
  ? new RedisRewriteTaskGuard(redisClient)
  : new InMemoryRewriteTaskGuard();
app.log.info(
  { guard: redisClient ? "redis" : "memory" },
  "rewrite task guard selected"
);  

const rewriteRateLimiter = redisClient
  ? new RedisRewriteRateLimiter(redisClient)
  : new InMemoryRewriteRateLimiter();

app.log.info(
  { limiter: redisClient ? "redis" : "memory" },
  "rewrite rate limiter selected"
);

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

//注册路由
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

// 健康检查：用于确认服务是否正常启动
app.get("/health", async () => {
  return { ok: true };
});

// 启动函数：异步监听端口
async function start() {
  try {
    await app.listen({ host: "0.0.0.0", port: 3101 });
    app.log.info("api-next running at http://localhost:3101");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// 显式启动，避免未处理 Promise 的告警
void start();

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
