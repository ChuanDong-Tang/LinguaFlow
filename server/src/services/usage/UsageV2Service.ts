import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { MembershipTier, SubscriptionService } from "../subscription/SubscriptionService.js";
import { dateKeyRangeInTimeZone } from "../time/businessClock.js";

export const USAGE_API_VERSION = "v2";

export class TokenQuotaExceededError extends Error {
  readonly code = "TOKEN_QUOTA_EXCEEDED";
  constructor(readonly remainingTokens: number, readonly refreshAt: Date) {
    super("AI usage for the current period has been exhausted");
  }
}

export class TokenRequestAlreadyExistsError extends Error {
  readonly code = "TOKEN_REQUEST_ALREADY_EXISTS";
  constructor(readonly requestId: string) {
    super("This AI request has already been processed");
  }
}

export class ImageStorageQuotaExceededError extends Error {
  readonly code = "IMAGE_STORAGE_QUOTA_EXCEEDED";
  constructor() { super("Image upload allowance for the current period has been exhausted"); }
}

export class DailyImageUploadLimitExceededError extends Error {
  readonly code = "DAILY_IMAGE_UPLOAD_LIMIT_EXCEEDED";
  constructor(readonly limit: number) { super("Daily image upload limit has been reached"); }
}

export type UsageV2View = {
  apiVersion: typeof USAGE_API_VERSION;
  configVersion: string;
  tier: MembershipTier;
  token: {
    periodStart: string;
    periodEnd: string;
    quota: number;
    used: number;
    reserved: number;
    remaining: number;
    remainingPercent: number;
  };
  images: {
    periodStart: string;
    periodEnd: string;
    quotaBytes: string;
    uploadedBytes: string;
    reservedUploadBytes: string;
    remainingUploadBytes: string;
    // Compatibility aliases for clients released before monthly upload metering.
    capacityBytes: string;
    usedBytes: string;
    reservedBytes: string;
    remainingBytes: string;
    dailyUploadLimit: number;
  };
  features: {
    community: boolean;
    dictation: boolean;
    originalLearning: boolean;
  };
};

type TokenCycleRow = {
  id: string;
  quotaTokens: number;
  reservedTokens: number;
  usedTokens: number;
  periodStart: Date;
  periodEnd: Date;
};

type ImageAccountRow = {
  id: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  capacityBytes: bigint;
  reservedBytes: bigint;
  usedBytes: bigint;
};

type UsagePrismaClient = {
  $transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
  aiTokenCycle: {
    upsert(args: any): Promise<TokenCycleRow>;
    findUnique(args: any): Promise<TokenCycleRow | null>;
  };
  imageStorageAccount: {
    upsert(args: any): Promise<ImageAccountRow>;
    findUnique(args: any): Promise<ImageAccountRow | null>;
    create(args: any): Promise<ImageAccountRow>;
    update(args: any): Promise<ImageAccountRow>;
  };
  usageV2SystemState: {
    findUnique(args: any): Promise<{ launchedAt: Date } | null>;
  };
};

export type TokenReservationView = {
  requestId: string;
  status: "reserved" | "settled" | "released";
  reservedTokens: number;
  totalTokens: number;
};

export class UsageV2Service {
  constructor(
    private readonly prisma: UsagePrismaClient,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async getCurrentUsage(userId: string, now = new Date()): Promise<UsageV2View> {
    const subscription = await this.subscriptionService.getCurrentSubscription(userId, now);
    const config = getRuntimeConfig();
    const launchState = await this.prisma.usageV2SystemState.findUnique({ where: { key: "launch" } });
    if (!launchState) throw new Error("USAGE_V2_LAUNCH_STATE_MISSING");
    const subscriptionPeriod = resolveTokenPeriod(subscription, now, config.quotaTimeZone);
    const period = resolveGrantPeriod(subscriptionPeriod, subscription, launchState.launchedAt);
    const fullQuotaTokens = tokenLimit(subscription.tier);
    const quotaTokens = period.prorated
      ? prorateTokens(fullQuotaTokens, subscriptionPeriod.start, subscriptionPeriod.end, period.start)
      : fullQuotaTokens;
    let cycle = await this.prisma.aiTokenCycle.upsert({
      where: {
        userId_apiVersion_periodStart: {
          userId,
          apiVersion: USAGE_API_VERSION,
          periodStart: period.start,
        },
      },
      create: {
        userId,
        apiVersion: USAGE_API_VERSION,
        tier: subscription.tier,
        periodStart: period.start,
        periodEnd: period.end,
        quotaTokens,
        grantSource: period.prorated
          ? "existing_subscription_proration"
          : subscription.subscription ? "subscription_cycle" : "free_calendar_month",
        configVersion: config.usageV2ConfigVersion,
      },
      // A paid cycle keeps the grant snapshot it was created with.
      update: {},
    });
    cycle = await this.reconcilePrematureTokenUsage(userId, cycle, now);
    const capacityBytes = BigInt(monthlyImageUploadLimit(subscription.tier));
    const imageAccount = await this.ensureImageUploadCycle({
      userId,
      tier: subscription.tier,
      periodStart: subscriptionPeriod.start,
      periodEnd: subscriptionPeriod.end,
      capacityBytes,
      configVersion: config.usageV2ConfigVersion,
    });
    const remainingTokens = Math.max(0, cycle.quotaTokens - cycle.usedTokens - cycle.reservedTokens);
    const remainingBytes = maxBigInt(0n, imageAccount.capacityBytes - imageAccount.usedBytes - imageAccount.reservedBytes);
    return {
      apiVersion: USAGE_API_VERSION,
      configVersion: config.usageV2ConfigVersion,
      tier: subscription.tier,
      token: {
        periodStart: cycle.periodStart.toISOString(),
        periodEnd: cycle.periodEnd.toISOString(),
        quota: cycle.quotaTokens,
        used: cycle.usedTokens,
        reserved: cycle.reservedTokens,
        remaining: remainingTokens,
        remainingPercent: cycle.quotaTokens > 0 ? Math.floor(remainingTokens * 100 / cycle.quotaTokens) : 0,
      },
      images: {
        periodStart: imageAccount.periodStart!.toISOString(),
        periodEnd: imageAccount.periodEnd!.toISOString(),
        quotaBytes: imageAccount.capacityBytes.toString(),
        uploadedBytes: imageAccount.usedBytes.toString(),
        reservedUploadBytes: imageAccount.reservedBytes.toString(),
        remainingUploadBytes: remainingBytes.toString(),
        capacityBytes: imageAccount.capacityBytes.toString(),
        usedBytes: imageAccount.usedBytes.toString(),
        reservedBytes: imageAccount.reservedBytes.toString(),
        remainingBytes: remainingBytes.toString(),
        dailyUploadLimit: dailyImageLimit(subscription.tier),
      },
      features: {
        community: subscription.tier === "pro",
        dictation: subscription.tier === "pro",
        originalLearning: subscription.tier === "pro",
      },
    };
  }

  private async reconcilePrematureTokenUsage(
    userId: string,
    currentCycle: TokenCycleRow,
    now: Date,
  ): Promise<TokenCycleRow> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
        `token-cycle-repair:${userId}`,
      );
      const premature = await tx.$queryRawUnsafe(
        `SELECT
           t."cycleId",
           COALESCE(SUM(t."totalTokens") FILTER (WHERE t."status" = 'settled'), 0)::int AS "usedTokens",
           COALESCE(SUM(t."reservedTokens") FILTER (WHERE t."status" = 'reserved'), 0)::int AS "reservedTokens"
         FROM "ai_token_transactions" t
         JOIN "ai_token_cycles" source ON source."id" = t."cycleId"
         WHERE t."userId" = $1
           AND t."cycleId" <> $2
           AND source."periodStart" > $3
           AND t."createdAt" < source."periodStart"
         GROUP BY t."cycleId"`,
        userId,
        currentCycle.id,
        now,
      ) as Array<{ cycleId: string; usedTokens: number; reservedTokens: number }>;
      for (const source of premature) {
        const changed = await tx.$executeRawUnsafe(
          `UPDATE "ai_token_cycles"
              SET "usedTokens" = "usedTokens" + $1,
                  "reservedTokens" = "reservedTokens" + $2,
                  "updatedAt" = NOW()
            WHERE "id" = $3
              AND "usedTokens" + "reservedTokens" + $1 + $2 <= "quotaTokens"`,
          source.usedTokens,
          source.reservedTokens,
          currentCycle.id,
        );
        if (changed === 0) continue;
        const sourceChanged = await tx.$executeRawUnsafe(
          `UPDATE "ai_token_cycles"
              SET "usedTokens" = "usedTokens" - $1,
                  "reservedTokens" = "reservedTokens" - $2,
                  "updatedAt" = NOW()
            WHERE "id" = $3`,
          source.usedTokens,
          source.reservedTokens,
          source.cycleId,
        );
        if (sourceChanged === 0) throw new Error("TOKEN_PREMATURE_CYCLE_REPAIR_FAILED");
        await tx.$executeRawUnsafe(
          `UPDATE "ai_token_transactions" t
              SET "cycleId" = $1, "updatedAt" = NOW()
             FROM "ai_token_cycles" source
            WHERE t."cycleId" = source."id"
              AND t."cycleId" = $2
              AND t."userId" = $3
              AND source."periodStart" > $4
              AND t."createdAt" < source."periodStart"`,
          currentCycle.id,
          source.cycleId,
          userId,
          now,
        );
      }
      const refreshed = await tx.aiTokenCycle.findUnique({ where: { id: currentCycle.id } });
      if (!refreshed) throw new Error("TOKEN_CYCLE_NOT_FOUND");
      return refreshed;
    });
  }

  private async ensureImageUploadCycle(input: {
    userId: string;
    tier: MembershipTier;
    periodStart: Date;
    periodEnd: Date;
    capacityBytes: bigint;
    configVersion: string;
  }): Promise<ImageAccountRow> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
        imageUsageLockKey(input.userId),
      );
      const existing = await tx.imageStorageAccount.findUnique({ where: { userId: input.userId } });
      if (!existing) {
        return tx.imageStorageAccount.create({
          data: {
            userId: input.userId,
            tier: input.tier,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            capacityBytes: input.capacityBytes,
            configVersion: input.configVersion,
          },
        });
      }
      const periodChanged = existing.periodStart?.getTime() !== input.periodStart.getTime()
        || existing.periodEnd?.getTime() !== input.periodEnd.getTime();
      let reconciledUsage: { usedBytes: bigint; reservedBytes: bigint } | null = null;
      if (periodChanged || existing.reservedBytes > 0n) {
        const rows = await tx.$queryRawUnsafe(
          `SELECT
             COALESCE(SUM("bytes") FILTER (WHERE "kind" = 'upload' AND "status" = 'committed'), 0)::bigint AS "usedBytes",
             COALESCE(SUM("bytes") FILTER (WHERE "kind" = 'upload' AND "status" = 'reserved'), 0)::bigint AS "reservedBytes"
           FROM "image_storage_transactions"
           WHERE "accountId" = $1
             AND "createdAt" >= $2
             AND "createdAt" < $3`,
          existing.id,
          input.periodStart,
          input.periodEnd,
        ) as Array<{ usedBytes: bigint; reservedBytes: bigint }>;
        reconciledUsage = rows[0] ?? { usedBytes: 0n, reservedBytes: 0n };
      }
      return tx.imageStorageAccount.update({
        where: { id: existing.id },
        data: {
          tier: input.tier,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          capacityBytes: input.capacityBytes,
          configVersion: input.configVersion,
          ...(reconciledUsage ?? {}),
        },
      });
    });
  }

  async reserveTokens(input: {
    userId: string;
    requestId: string;
    feature: "rewrite" | "organization" | "reply" | "dictionary";
    estimatedTokens: number;
    provider?: string;
    model?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<TokenReservationView> {
    assertPositiveInteger(input.estimatedTokens, "estimatedTokens");
    const usage = await this.getCurrentUsage(input.userId);
    const periodStart = new Date(usage.token.periodStart);
    try {
      return await this.prisma.$transaction(async (tx) => {
      await lockUsageRequest(tx, input.userId, input.requestId);
      const existing = await tx.aiTokenTransaction.findUnique({
        where: { userId_requestId: { userId: input.userId, requestId: input.requestId } },
      });
      if (existing) throw new TokenRequestAlreadyExistsError(input.requestId);
      const cycle = await tx.aiTokenCycle.findUnique({
        where: { userId_apiVersion_periodStart: { userId: input.userId, apiVersion: USAGE_API_VERSION, periodStart } },
      });
      if (!cycle) throw new Error("TOKEN_CYCLE_NOT_FOUND");
      const changed = await tx.$executeRawUnsafe(
        `UPDATE "ai_token_cycles"
            SET "reservedTokens" = "reservedTokens" + $1, "updatedAt" = NOW()
          WHERE "id" = $2
            AND "usedTokens" + "reservedTokens" + $1 <= "quotaTokens"`,
        input.estimatedTokens,
        cycle.id,
      );
      if (changed === 0) {
        throw new TokenQuotaExceededError(usage.token.remaining, new Date(usage.token.periodEnd));
      }
      const created = await tx.aiTokenTransaction.create({
        data: {
          userId: input.userId,
          cycleId: cycle.id,
          requestId: input.requestId,
          feature: input.feature,
          status: "reserved",
          reservedTokens: input.estimatedTokens,
          provider: input.provider,
          model: input.model,
          metadata: input.metadata,
        },
      });
      return tokenTransactionView(created);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new TokenRequestAlreadyExistsError(input.requestId);
      throw error;
    }
  }

  async settleTokens(input: {
    userId: string;
    requestId: string;
    inputTokens: number;
    outputTokens: number;
    meteringSource: "provider" | "tokenizer";
    provider?: string;
    model?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<TokenReservationView> {
    assertNonnegativeInteger(input.inputTokens, "inputTokens");
    assertNonnegativeInteger(input.outputTokens, "outputTokens");
    const totalTokens = input.inputTokens + input.outputTokens;
    return this.prisma.$transaction(async (tx) => {
      await lockUsageRequest(tx, input.userId, input.requestId);
      const transaction = await tx.aiTokenTransaction.findUnique({
        where: { userId_requestId: { userId: input.userId, requestId: input.requestId } },
      });
      if (!transaction) throw new Error("TOKEN_RESERVATION_NOT_FOUND");
      if (transaction.status !== "reserved") return tokenTransactionView(transaction);
      const changed = await tx.$executeRawUnsafe(
        `UPDATE "ai_token_cycles"
            SET "reservedTokens" = "reservedTokens" - $1,
                "usedTokens" = "usedTokens" + $2,
                "updatedAt" = NOW()
          WHERE "id" = $3
            AND "reservedTokens" >= $1
            AND "usedTokens" + "reservedTokens" - $1 + $2 <= "quotaTokens"`,
        transaction.reservedTokens,
        totalTokens,
        transaction.cycleId,
      );
      if (changed === 0) throw new Error("TOKEN_SETTLEMENT_EXCEEDS_CYCLE");
      const settled = await tx.aiTokenTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "settled",
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          totalTokens,
          meteringSource: input.meteringSource,
          provider: input.provider ?? transaction.provider,
          model: input.model ?? transaction.model,
          ...(input.metadata ? { metadata: { ...jsonObject(transaction.metadata), ...input.metadata } } : {}),
          settledAt: new Date(),
        },
      });
      return tokenTransactionView(settled);
    });
  }

  async releaseTokens(userId: string, requestId: string): Promise<TokenReservationView> {
    return this.prisma.$transaction(async (tx) => {
      await lockUsageRequest(tx, userId, requestId);
      const transaction = await tx.aiTokenTransaction.findUnique({
        where: { userId_requestId: { userId, requestId } },
      });
      if (!transaction) throw new Error("TOKEN_RESERVATION_NOT_FOUND");
      if (transaction.status !== "reserved") return tokenTransactionView(transaction);
      await tx.aiTokenCycle.update({
        where: { id: transaction.cycleId },
        data: { reservedTokens: { decrement: transaction.reservedTokens } },
      });
      const released = await tx.aiTokenTransaction.update({
        where: { id: transaction.id },
        data: { status: "released", settledAt: new Date() },
      });
      return tokenTransactionView(released);
    });
  }

  async reserveImageBytes(input: {
    userId: string;
    requestId: string;
    estimatedBytes: number;
    imageId?: string;
    objectKey?: string;
  }): Promise<void> {
    assertPositiveInteger(input.estimatedBytes, "estimatedBytes");
    const usage = await this.getCurrentUsage(input.userId);
    const dateKey = formatDateKey(new Date(), getRuntimeConfig().quotaTimeZone);
    await this.prisma.$transaction(async (tx) => {
      await lockImageUsage(tx, input.userId);
      const existing = await tx.imageStorageTransaction.findUnique({
        where: { userId_requestId_kind: { userId: input.userId, requestId: input.requestId, kind: "upload" } },
      });
      if (existing) return;
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
        `image-daily:${input.userId}:${dateKey}`,
      );
      const activeUploads = await tx.imageStorageTransaction.count({
        where: { userId: input.userId, dateKey, kind: "upload", status: { in: ["reserved", "committed"] } },
      });
      if (activeUploads >= usage.images.dailyUploadLimit) {
        throw new DailyImageUploadLimitExceededError(usage.images.dailyUploadLimit);
      }
      const changed = await tx.$executeRawUnsafe(
        `UPDATE "image_storage_accounts"
            SET "reservedBytes" = "reservedBytes" + $1, "updatedAt" = NOW()
          WHERE "userId" = $2
            AND "usedBytes" + "reservedBytes" + $1 <= "capacityBytes"`,
        BigInt(input.estimatedBytes),
        input.userId,
      );
      if (changed === 0) throw new ImageStorageQuotaExceededError();
      const account = await tx.imageStorageAccount.findUnique({ where: { userId: input.userId } });
      await tx.imageStorageTransaction.create({
        data: {
          userId: input.userId,
          accountId: account.id,
          requestId: input.requestId,
          kind: "upload",
          status: "reserved",
          dateKey,
          bytes: BigInt(input.estimatedBytes),
          imageId: input.imageId,
          objectKey: input.objectKey,
        },
      });
    });
  }

  async commitImageBytes(input: { userId: string; requestId: string; actualBytes: number }): Promise<void> {
    assertPositiveInteger(input.actualBytes, "actualBytes");
    await this.prisma.$transaction(async (tx) => {
      await lockImageUsage(tx, input.userId);
      const transaction = await tx.imageStorageTransaction.findUnique({
        where: { userId_requestId_kind: { userId: input.userId, requestId: input.requestId, kind: "upload" } },
      });
      if (!transaction) return;
      if (transaction.status !== "reserved") return;
      const account = await tx.imageStorageAccount.findUnique({ where: { id: transaction.accountId } });
      if (!account) return;
      if (account.periodStart && transaction.createdAt < account.periodStart) {
        await tx.imageStorageTransaction.update({
          where: { id: transaction.id },
          data: { status: "committed", bytes: BigInt(input.actualBytes), metadata: { committedOutsideCurrentPeriod: true } },
        });
        return;
      }
      const changed = await tx.$executeRawUnsafe(
        `UPDATE "image_storage_accounts"
            SET "reservedBytes" = "reservedBytes" - $1,
                "usedBytes" = "usedBytes" + $2,
                "updatedAt" = NOW()
          WHERE "id" = $3 AND "reservedBytes" >= $1
            AND "usedBytes" + "reservedBytes" - $1 + $2 <= "capacityBytes"`,
        transaction.bytes,
        BigInt(input.actualBytes),
        transaction.accountId,
      );
      if (changed === 0) throw new ImageStorageQuotaExceededError();
      await tx.imageStorageTransaction.update({
        where: { id: transaction.id },
        data: { status: "committed", bytes: BigInt(input.actualBytes) },
      });
    });
  }

  async releaseImageReservation(userId: string, requestId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockImageUsage(tx, userId);
      const transaction = await tx.imageStorageTransaction.findUnique({
        where: { userId_requestId_kind: { userId, requestId, kind: "upload" } },
      });
      if (!transaction || transaction.status !== "reserved") return;
      const account = await tx.imageStorageAccount.findUnique({ where: { id: transaction.accountId } });
      if (account && (!account.periodStart || transaction.createdAt >= account.periodStart)) {
        await tx.imageStorageAccount.update({
          where: { id: transaction.accountId },
          data: { reservedBytes: { decrement: transaction.bytes } },
        });
      }
      await tx.imageStorageTransaction.update({
        where: { id: transaction.id },
        data: { status: "released" },
      });
    });
  }

  async releaseCommittedImage(input: {
    userId: string;
    requestId: string;
    bytes: number;
    imageId?: string;
    objectKey?: string;
  }): Promise<void> {
    assertPositiveInteger(input.bytes, "bytes");
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.imageStorageTransaction.findUnique({
        where: { userId_requestId_kind: { userId: input.userId, requestId: input.requestId, kind: "delete" } },
      });
      if (existing) return;
      const upload = input.imageId ? await tx.imageStorageTransaction.findUnique({
        where: { userId_requestId_kind: { userId: input.userId, requestId: input.imageId, kind: "upload" } },
      }) : null;
      if (!upload || upload.status !== "committed") return;
      await tx.imageStorageTransaction.create({
        data: {
          userId: input.userId,
          accountId: upload.accountId,
          requestId: input.requestId,
          kind: "delete",
          status: "committed",
          dateKey: formatDateKey(new Date(), getRuntimeConfig().quotaTimeZone),
          bytes: upload.bytes,
          imageId: input.imageId,
          objectKey: input.objectKey,
          metadata: { uploadTransactionId: upload.id },
        },
      });
    });
  }
}

function resolveTokenPeriod(
  subscription: Awaited<ReturnType<SubscriptionService["getCurrentSubscription"]>>,
  now: Date,
  timeZone: string,
): { start: Date; end: Date } {
  if (!subscription.subscription) return calendarMonthUtcWindow(now, timeZone);
  const start = subscription.subscription.startedAt;
  const subscriptionEnd = subscription.subscription.expiresAt;
  for (let index = 0; index < 240; index += 1) {
    const cursor = addUtcMonthsClamped(start, index);
    const next = addUtcMonthsClamped(start, index + 1);
    if (now < next || next >= subscriptionEnd) {
      return { start: cursor, end: next < subscriptionEnd ? next : subscriptionEnd };
    }
  }
  return { start, end: subscriptionEnd };
}

function calendarMonthUtcWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endKey = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const start = dateKeyRangeInTimeZone(startKey, timeZone).start;
  const end = dateKeyRangeInTimeZone(endKey, timeZone).start;
  return { start, end };
}

function addUtcMonthsClamped(value: Date, months: number): Date {
  const day = value.getUTCDate();
  const next = new Date(value);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function resolveGrantPeriod(
  period: { start: Date; end: Date },
  subscription: Awaited<ReturnType<SubscriptionService["getCurrentSubscription"]>>,
  launchedAt: Date,
): { start: Date; end: Date; prorated: boolean } {
  const prorated = Boolean(
    subscription.subscription &&
    subscription.subscription.startedAt < launchedAt &&
    launchedAt > period.start &&
    launchedAt < period.end
  );
  return { start: prorated ? launchedAt : period.start, end: period.end, prorated };
}

function prorateTokens(quota: number, periodStart: Date, periodEnd: Date, grantStart: Date): number {
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  const remainingMs = periodEnd.getTime() - grantStart.getTime();
  if (totalMs <= 0 || remainingMs <= 0) return 0;
  return Math.max(1, Math.floor(quota * remainingMs / totalMs));
}

function tokenLimit(tier: MembershipTier): number {
  const config = getRuntimeConfig();
  if (tier === "pro") return config.proMonthlyTokenLimit;
  if (tier === "plus") return config.plusMonthlyTokenLimit;
  return config.freeMonthlyTokenLimit;
}

function monthlyImageUploadLimit(tier: MembershipTier): number {
  const config = getRuntimeConfig();
  if (tier === "pro") return config.proImageStorageBytes;
  if (tier === "plus") return config.plusImageStorageBytes;
  return config.freeImageStorageBytes;
}

function dailyImageLimit(tier: MembershipTier): number {
  const config = getRuntimeConfig();
  if (tier === "pro") return config.proDailyImageUploadLimit;
  if (tier === "plus") return config.plusDailyImageUploadLimit;
  return config.freeDailyImageUploadLimit;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function tokenTransactionView(row: any): TokenReservationView {
  return {
    requestId: row.requestId,
    status: row.status,
    reservedTokens: row.reservedTokens,
    totalTokens: row.totalTokens,
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`INVALID_${name.toUpperCase()}`);
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${name.toUpperCase()}`);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002";
}

async function lockUsageRequest(tx: any, userId: string, requestId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
    `usage-v2:${userId}:${requestId}`,
  );
}

function imageUsageLockKey(userId: string): string {
  return `image-usage-v2:${userId}`;
}

async function lockImageUsage(tx: any, userId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
    imageUsageLockKey(userId),
  );
}

function formatDateKey(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
