import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AppLocale,
  GuideState,
  LearningLanguage,
  PromptDifficulty,
  TtsProviderCode,
  UserPreferenceEntity,
  UserPreferenceRepository,
} from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { EntitlementService } from "@lf/server/services/entitlement/EntitlementService.js";
import type { SubscriptionService } from "@lf/server/services/subscription/SubscriptionService.js";
import type { PaymentEntitlementRefreshService } from "@lf/server/services/payment/PaymentEntitlementRefreshService.js";
import { isConfiguredTtsVoice, resolveDefaultTtsVoice } from "@lf/server/services/tts/TtsVoiceCatalog.js";
import {
  AccountDisabledError,
  AccountPendingDeleteError,
  resolveActiveUserContext,
  UnauthorizedError,
  type UserContext,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { checkIpPathRateLimit } from "../lib/rateLimit.js";

export interface MeRouteDeps {
  subscriptionService: SubscriptionService;
  entitlementService: EntitlementService;
  paymentEntitlementRefreshService: PaymentEntitlementRefreshService;
  userPreferenceRepository: UserPreferenceRepository;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

type UpdatePreferencesBody = {
  appLocale?: AppLocale;
  learningLanguage?: LearningLanguage;
  promptDifficulty?: PromptDifficulty;
  guideState?: GuideState;
  ttsProvider?: TtsProviderCode;
  ttsVoiceCode?: string | null;
  sttMultilingualRecognitionEnabled?: boolean;
};

const GUIDE_STATE_MAX_KEYS = 80;
const GUIDE_STATE_COMPLETED_AT_MAX_LENGTH = 64;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  app.get("/me/preferences", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const userContext = await resolveMeUserContext(req, reply, deps, requestId, "/me/preferences");
    if (!userContext) return;

    const preference = await deps.userPreferenceRepository.getByUserId(userContext.userId);

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: toPreferenceResponse(preference),
    });
  });

  app.put("/me/preferences", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const body = req.body as unknown;
    if (!isUpdatePreferencesBody(body)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid preferences payload" },
      });
    }

    const userContext = await resolveMeUserContext(req, reply, deps, requestId, "/me/preferences");
    if (!userContext) return;

    const currentPreference = await deps.userPreferenceRepository.getByUserId(userContext.userId);
    const nextProvider = body.ttsProvider ?? currentPreference.ttsProvider;
    const nextLearningLanguage = body.learningLanguage ?? currentPreference.learningLanguage;
    const requestedTtsVoiceCode = typeof body.ttsVoiceCode === "string" ? body.ttsVoiceCode.trim() : body.ttsVoiceCode;
    const nextTtsVoiceCode = resolveNextTtsVoiceCode({
      currentVoiceCode: currentPreference.ttsVoiceCode,
      requestedVoiceCode: requestedTtsVoiceCode,
      provider: nextProvider,
      learningLanguage: nextLearningLanguage,
      shouldNormalizeExisting:
        body.learningLanguage !== undefined ||
        body.ttsProvider !== undefined ||
        body.ttsVoiceCode !== undefined,
    });
    if (
      nextTtsVoiceCode &&
      !isConfiguredTtsVoice({
        provider: nextProvider,
        languageCode: nextLearningLanguage,
        voiceCode: nextTtsVoiceCode,
      })
    ) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "TTS voice does not match learning language" },
      });
    }

    const preference = await deps.userPreferenceRepository.upsert({
      userId: userContext.userId,
      appLocale: body.appLocale,
      learningLanguage: body.learningLanguage,
      promptDifficulty: body.promptDifficulty,
      guideState: body.guideState ? mergeGuideState(currentPreference.guideState, body.guideState) : undefined,
      ttsProvider: body.ttsProvider,
      ttsVoiceCode: body.ttsVoiceCode !== undefined || nextTtsVoiceCode !== currentPreference.ttsVoiceCode
        ? nextTtsVoiceCode
        : undefined,
      sttMultilingualRecognitionEnabled: body.sttMultilingualRecognitionEnabled,
    });

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: toPreferenceResponse(preference),
    });
  });

  app.get("/me/subscription", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    let userContext;
    try {
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/me/subscription" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    const subscription = await deps.subscriptionService.getCurrentSubscription(
      userContext.userId
    );

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: {
        userId: userContext.userId,
        source: userContext.source,
        plan: subscription.plan,
        tier: subscription.tier,
        isPro: subscription.isPro,
        isPlus: subscription.isPlus,
        isMember: subscription.isMember,
        expiresAt: subscription.expiresAt?.toISOString() ?? null,
      },
    });
  });

  app.get("/me/entitlement", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    let userContext;
    try {
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/me/entitlement" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    const data = await deps.entitlementService.getCurrentEntitlement(userContext.userId);

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: {
        ...data,
        source: userContext.source,
      },
    });
  });

  // 手动查单刷新权益：只对当前用户做局部补偿，不触发全局支付 worker。
  app.post("/me/entitlement/refresh", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkIpPathRateLimit({
      req,
      reply,
      requestId,
      systemEventLogRepository: deps.systemEventLogRepository,
      module: "payment",
      routeKey: "me_entitlement_refresh",
      path: "/me/entitlement/refresh",
      limit: 5,
      windowSec: 60,
      keyPrefix: "rl:payment",
      exceededEvent: "payment.entitlement_refresh.rate_limited",
      redisUnavailableEvent: "payment.entitlement_refresh.rate_limit_redis_unavailable",
      onExceeded: async () => {
        await reply.status(429).send({
          ok: false,
          request_id: requestId,
          error: { code: "RATE_LIMITED", message: "Too many refresh requests" },
        });
      },
    });
    if (!allowed) return;

    let userContext;
    try {
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/me/entitlement/refresh" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    try {
      const data = await deps.paymentEntitlementRefreshService.refreshForUser(userContext.userId);
      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: {
          ...data,
          entitlement: {
            ...data.entitlement,
            source: userContext.source,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh entitlement failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.entitlement_refresh.failed",
        level: "error",
        status: "failed",
        errorCode: "ENTITLEMENT_REFRESH_FAILED",
        errorMessage: message,
      });
      return reply.status(502).send({
        ok: false,
        request_id: requestId,
        error: { code: "ENTITLEMENT_REFRESH_FAILED", message: "Refresh entitlement failed" },
      });
    }
  });
}

async function resolveMeUserContext(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: MeRouteDeps,
  requestId: string,
  path: string
): Promise<UserContext | null> {
  try {
    return await resolveActiveUserContext({
      authorization: firstHeaderValue(req.headers.authorization),
      userRepository: deps.userRepository,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await reply.status(401).send({
        ok: false,
        request_id: requestId,
        error: { code: error.code, message: error.message },
      });
      return null;
    }
    if (error instanceof AccountDisabledError) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.account_disabled",
        level: "warn",
        status: "failed",
        errorCode: "ACCOUNT_DISABLED",
        metadata: { path },
      });
      await reply.status(403).send({
        ok: false,
        request_id: requestId,
        error: { code: error.code, message: error.message },
      });
      return null;
    }
    if (error instanceof AccountPendingDeleteError) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.account_pending_delete",
        level: "warn",
        status: "failed",
        errorCode: "ACCOUNT_PENDING_DELETE",
        metadata: { path },
      });
      await reply.status(403).send({
        ok: false,
        request_id: requestId,
        error: { code: error.code, message: error.message },
      });
      return null;
    }

    throw error;
  }
}

function isUpdatePreferencesBody(value: unknown): value is UpdatePreferencesBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const keys = [
    "appLocale",
    "learningLanguage",
    "promptDifficulty",
    "guideState",
    "ttsProvider",
    "ttsVoiceCode",
    "sttMultilingualRecognitionEnabled",
  ];
  if (!Object.keys(body).some((key) => keys.includes(key))) return false;

  return (
    (body.appLocale === undefined || isAppLocale(body.appLocale)) &&
    (body.learningLanguage === undefined || isLearningLanguage(body.learningLanguage)) &&
    (body.promptDifficulty === undefined || isPromptDifficulty(body.promptDifficulty)) &&
    (body.guideState === undefined || isGuideState(body.guideState)) &&
    (body.ttsProvider === undefined || body.ttsProvider === "azure_global") &&
    (body.sttMultilingualRecognitionEnabled === undefined ||
      typeof body.sttMultilingualRecognitionEnabled === "boolean") &&
    (body.ttsVoiceCode === undefined ||
      body.ttsVoiceCode === null ||
      (typeof body.ttsVoiceCode === "string" &&
        body.ttsVoiceCode.trim().length > 0 &&
        body.ttsVoiceCode.length <= 120))
  );
}

function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "zh-TW" || value === "en-US" || value === "ja-JP";
}

function isLearningLanguage(value: unknown): value is LearningLanguage {
  return value === "en-US" || value === "ja-JP";
}

function isPromptDifficulty(value: unknown): value is PromptDifficulty {
  return value === "simple" || value === "native";
}

function isGuideState(value: unknown): value is GuideState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > GUIDE_STATE_MAX_KEYS) return false;
  return entries.every(([key, entry]) => {
    if (key.length <= 0 || key.length > 80 || !/^[a-z0-9_]+$/.test(key)) return false;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const completedAt = (entry as Record<string, unknown>).completedAt;
    return completedAt === undefined ||
      (typeof completedAt === "string" && completedAt.length <= GUIDE_STATE_COMPLETED_AT_MAX_LENGTH);
  });
}

function mergeGuideState(current: GuideState, next: GuideState): GuideState {
  return { ...current, ...next };
}

function resolveNextTtsVoiceCode(input: {
  currentVoiceCode: string | null;
  requestedVoiceCode: string | null | undefined;
  provider: TtsProviderCode;
  learningLanguage: LearningLanguage;
  shouldNormalizeExisting: boolean;
}): string | null {
  if (input.requestedVoiceCode !== undefined) return input.requestedVoiceCode;
  if (!input.shouldNormalizeExisting) return input.currentVoiceCode;
  if (
    input.currentVoiceCode &&
    isConfiguredTtsVoice({
      provider: input.provider,
      languageCode: input.learningLanguage,
      voiceCode: input.currentVoiceCode,
    })
  ) {
    return input.currentVoiceCode;
  }
  return resolveDefaultTtsVoice(input.learningLanguage, input.provider);
}

function toPreferenceResponse(preference: UserPreferenceEntity) {
  return {
    userId: preference.userId,
    appLocale: preference.appLocale,
    learningLanguage: preference.learningLanguage,
    promptDifficulty: preference.promptDifficulty,
    guideState: preference.guideState,
    ttsProvider: preference.ttsProvider,
    ttsVoiceCode: preference.ttsVoiceCode,
    sttMultilingualRecognitionEnabled: preference.sttMultilingualRecognitionEnabled,
    createdAt: preference.createdAt.toISOString(),
    updatedAt: preference.updatedAt.toISOString(),
  };
}
