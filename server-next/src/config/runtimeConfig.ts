export type RuntimeMode = "development" | "production" | "test";

export interface RuntimeConfig {
  mode: RuntimeMode;
  isProduction: boolean;
  allowMockAuth: boolean;
  mockUserIds: string[];
  requireRedis: boolean;
  redisUrl: string | null;
  authingDomain: string | null;
  authingAppId: string | null;
  authingAppSecret: string | null;
  authJwtSecret: string;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlSeconds: number;
  deepSeekApiKey: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  deepSeekTimeoutMs: number;
  quotaTimeZone: string;
  proDailyTotalLimit: number;
  freeDailyTotalLimit: number;
  proMonthlyPriceCents: number;
  paymentPendingReuseWindowMs: number;
  paymentReconcileGraceMs: number;
  paymentPendingExpireMs: number;
  paymentReconcileBatchSize: number;
  paymentReconcileIntervalMs: number;
  sessionCleanupEnabled: boolean;
  sessionCleanupIntervalMs: number;
  sessionRevokedRetentionDays: number;
  sessionCleanupBatchSize: number;
  systemEventLogCleanupEnabled: boolean;
  systemEventLogCleanupIntervalMs: number;
  systemEventLogRetentionDays: number;
  systemEventLogCleanupBatchSize: number;
  aiRequestLogCleanupEnabled: boolean;
  aiRequestLogCleanupIntervalMs: number;
  aiRequestLogRetentionDays: number;
  aiRequestLogCleanupBatchSize: number;
  wechatPayNotifyUrl: string | null;
  appleIapIssuerId: string | null;
  appleIapKeyId: string | null;
  appleIapBundleId: string | null;
  appleIapPrivateKey: string | null;
  appleIapRootCa: string | null;
  appleIapProMonthlyProductId: string | null;
  rewriteTaskTtlMs: number;
  rewriteGlobalRateLimit: number;
  rewriteGlobalRateWindowMs: number;
  rewriteUserRateLimit: number;
  rewriteUserRateWindowMs: number;
  rewriteMaxInputChars: number;
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const mode = normalizeMode(env.NODE_ENV);
  return {
    mode,
    isProduction: mode === "production",
    allowMockAuth: readBoolean(env.LF_ALLOW_MOCK_AUTH, false),
    mockUserIds: readCsv(env.LF_MOCK_USER_IDS, ["mock_user_001"]),
    requireRedis: readBoolean(env.LF_REQUIRE_REDIS, mode === "production"),
    redisUrl: trimToNull(env.REDIS_URL),
    authingDomain: trimToNull(env.AUTHING_DOMAIN),
    authingAppId: trimToNull(env.AUTHING_APP_ID),
    authingAppSecret: trimToNull(env.AUTHING_APP_SECRET),
    authJwtSecret: env.AUTH_JWT_SECRET?.trim() || "dev-only-change-me",
    authAccessTokenTtlSeconds: readPositiveInt(env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 60 * 30),
    authRefreshTokenTtlSeconds: readPositiveInt(env.AUTH_REFRESH_TOKEN_TTL_SECONDS, 60 * 60 * 24 * 30),
    deepSeekApiKey: env.DEEPSEEK_API_KEY?.trim() || "",
    deepSeekBaseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    deepSeekModel: env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
    deepSeekTimeoutMs: readPositiveInt(env.DEEPSEEK_TIMEOUT_MS, 20_000),
    quotaTimeZone: env.LF_QUOTA_TIME_ZONE?.trim() || "Asia/Shanghai",
    proDailyTotalLimit: readPositiveInt(env.LF_PRO_DAILY_TOTAL_LIMIT, 10_000),
    freeDailyTotalLimit: readPositiveInt(env.LF_FREE_DAILY_TOTAL_LIMIT, 500),
    proMonthlyPriceCents: readPositiveInt(env.LF_PRO_MONTHLY_PRICE_CENTS, 1900),
    paymentPendingReuseWindowMs: readPositiveInt(env.LF_PAYMENT_PENDING_REUSE_WINDOW_MS, 300_000),
    paymentReconcileGraceMs: readPositiveInt(env.LF_PAYMENT_RECONCILE_GRACE_MS, 120_000),
    paymentPendingExpireMs: readPositiveInt(env.LF_PAYMENT_PENDING_EXPIRE_MS, 1_800_000),
    paymentReconcileBatchSize: readPositiveInt(env.LF_PAYMENT_RECONCILE_BATCH_SIZE, 20),
    paymentReconcileIntervalMs: readPositiveInt(env.LF_PAYMENT_RECONCILE_INTERVAL_MS, 60_000),
    sessionCleanupEnabled: readBoolean(env.LF_SESSION_CLEANUP_ENABLED, true),
    sessionCleanupIntervalMs: readPositiveInt(env.LF_SESSION_CLEANUP_INTERVAL_MS, 86_400_000),
    sessionRevokedRetentionDays: readPositiveInt(env.LF_SESSION_REVOKED_RETENTION_DAYS, 14),
    sessionCleanupBatchSize: readPositiveInt(env.LF_SESSION_CLEANUP_BATCH_SIZE, 1000),
    systemEventLogCleanupEnabled: readBoolean(env.LF_SYSTEM_EVENT_LOG_CLEANUP_ENABLED, true),
    systemEventLogCleanupIntervalMs: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_INTERVAL_MS, 86_400_000),
    systemEventLogRetentionDays: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_RETENTION_DAYS, 30),
    systemEventLogCleanupBatchSize: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_BATCH_SIZE, 2000),
    aiRequestLogCleanupEnabled: readBoolean(env.LF_AI_REQUEST_LOG_CLEANUP_ENABLED, true),
    aiRequestLogCleanupIntervalMs: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_INTERVAL_MS, 86_400_000),
    aiRequestLogRetentionDays: readPositiveInt(env.LF_AI_REQUEST_LOG_RETENTION_DAYS, 90),
    aiRequestLogCleanupBatchSize: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_BATCH_SIZE, 2000),
    wechatPayNotifyUrl: trimToNull(env.WECHAT_PAY_NOTIFY_URL),
    appleIapIssuerId: trimToNull(env.APPLE_IAP_ISSUER_ID),
    appleIapKeyId: trimToNull(env.APPLE_IAP_KEY_ID),
    appleIapBundleId: trimToNull(env.APPLE_IAP_BUNDLE_ID),
    appleIapPrivateKey: trimToNull(env.APPLE_IAP_PRIVATE_KEY),
    appleIapRootCa: trimToNull(env.APPLE_IAP_ROOT_CA),
    appleIapProMonthlyProductId: trimToNull(env.APPLE_IAP_PRO_MONTHLY_PRODUCT_ID),
    rewriteTaskTtlMs: readPositiveInt(env.REWRITE_TASK_TTL_MS, 60_000),
    rewriteGlobalRateLimit: readPositiveInt(env.REWRITE_GLOBAL_RATE_LIMIT, 30),
    rewriteGlobalRateWindowMs: readPositiveInt(env.REWRITE_GLOBAL_RATE_WINDOW_MS, 60_000),
    rewriteUserRateLimit: readPositiveInt(env.REWRITE_USER_RATE_LIMIT, 20),
    rewriteUserRateWindowMs: readPositiveInt(env.REWRITE_USER_RATE_WINDOW_MS, 60_000),
    rewriteMaxInputChars: readPositiveInt(env.REWRITE_MAX_INPUT_CHARS, 3000),
  };
}

function normalizeMode(value: string | undefined): RuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "test") return normalized;
  return "development";
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readCsv(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim();
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
