import { createApp, disconnectApp } from "./app.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";
import { getRedisClient } from "@lf/server/infrastructure/redis/redisClient.js";


const runtime = getRuntimeConfig();
//生产不允许Mock账号登录
if (runtime.mode === "production" && runtime.allowMockAuth) {
  console.error(
    "[startup] invalid config: LF_ALLOW_MOCK_AUTH must be false in production"
  );
  process.exit(1);
}

//生产检验AUTH_JWT_SECRET是否够强
if (runtime.mode === "production") {
  const secret = runtime.authJwtSecret.trim();
  if (!secret || secret === "dev-only-change-me" || secret.length < 32) {
     console.error(
      "[startup] invalid config: AUTH_JWT_SECRET must be non-default and length >= 32 in production"
    );
    process.exit(1);
  }
}

const app = createApp();

async function start() {
  // check redis 
  if (runtime.requireRedis) {
    const redisClient = getRedisClient(); // 这里已覆盖 REDIS_URL 缺失
    try {
      const pong = await redisClient!.ping();
      if (pong !== "PONG") throw new Error(`unexpected ping result: ${pong}`);
    } catch (err) {
      console.error("[startup] Redis unavailable", err);
      process.exit(1);
    }
  }

  try {
    const port = Number(process.env.PORT ?? process.env.LF_API_PORT ?? 3101);
    await app.listen({ host: "0.0.0.0", port });
    app.log.info(`api running at http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();

process.on("SIGINT", async () => {
  await disconnectApp();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await disconnectApp();
  process.exit(0);
});
