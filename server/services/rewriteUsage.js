import { authenticateClerkRequest } from "../core/auth.js";
import { getAppConfig } from "../core/appConfig.js";
import { getViewerAccessByClerkUserId } from "./access.js";
import { getSupabaseAdmin } from "../infrastructure/supabase.js";

function parseIntegerHeader(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

const REWRITE_USAGE_DOC_TYPE = "rewrite_usage_daily";

function toUtcDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseUsagePayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload;
}

async function readDailyCount(appUserId, dateKey) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_cloud_documents")
    .select("payload")
    .eq("user_id", appUserId)
    .eq("doc_type", REWRITE_USAGE_DOC_TYPE)
    .maybeSingle();
  if (error) throw error;
  const payload = parseUsagePayload(data?.payload);
  const count = Number.parseInt(String(payload?.[dateKey] ?? "0"), 10);
  return {
    payload,
    count: Number.isFinite(count) ? count : 0,
  };
}

export async function getRewriteUsageSnapshotByClerkUserId(clerkUserId) {
  if (!clerkUserId) return null;

  const config = getAppConfig();
  const viewer = await getViewerAccessByClerkUserId(clerkUserId);
  const hasPro = viewer.entitlements.some((item) => item.active && item.code === "pro_access");
  const appUserId = viewer.profile?.appUserId ?? "";
  if (!appUserId) return null;

  const dateKey = toUtcDateKey();
  const usage = await readDailyCount(appUserId, dateKey);
  return {
    daily_used: Math.max(0, Number(usage.count) || 0),
    daily_limit: hasPro ? config.proDailyReplyLimit : config.freeDailyReplyLimit,
  };
}

async function writeDailyCount(appUserId, payload, dateKey, count) {
  const supabase = getSupabaseAdmin();
  const nextPayload = {
    ...parseUsagePayload(payload),
    [dateKey]: count,
  };
  const { error } = await supabase
    .from("user_cloud_documents")
    .upsert(
      {
        user_id: appUserId,
        doc_type: REWRITE_USAGE_DOC_TYPE,
        payload: nextPayload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,doc_type" },
    );
  if (error) throw error;
}

export async function getRewriteAccessContext(req, config, mode = "rewrite") {
  const auth = await authenticateClerkRequest(req, { requireAuth: true });
  if (!auth.ok) {
    return {
      ok: false,
      code: auth.code,
      message: auth.message,
    };
  }

  const usage = {
    dailyCalls: parseIntegerHeader(req.headers["x-rewrite-daily-calls"]),
    dailyChars: parseIntegerHeader(req.headers["x-rewrite-daily-chars"]),
    monthlyCalls: parseIntegerHeader(req.headers["x-rewrite-monthly-calls"]),
    monthlyChars: parseIntegerHeader(req.headers["x-rewrite-monthly-chars"]),
  };

  const authenticatedUserId = auth.clerkUserId;
  if (!authenticatedUserId) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Sign in is required for rewrite access.",
    };
  }

  const viewer = await getViewerAccessByClerkUserId(authenticatedUserId);
  const hasPro = viewer.entitlements.some((item) => item.active && item.code === "pro_access");
  const appUserId = viewer.profile?.appUserId ?? "";
  if (!appUserId) {
    return {
      ok: false,
      status: 403,
      code: "PROFILE_REQUIRED",
      message: "Could not resolve user profile for usage tracking.",
    };
  }
  const appConfig = getAppConfig();
  const limit = hasPro ? appConfig.proDailyReplyLimit : appConfig.freeDailyReplyLimit;
  const dateKey = toUtcDateKey();
  const dailyUsage = await readDailyCount(appUserId, dateKey);
  if (dailyUsage.count >= limit) {
    return {
      ok: false,
      status: 429,
      code: "DAILY_LIMIT_REACHED",
      message: `Daily AI reply limit reached (${limit}).`,
    };
  }
  const quota = {
    mode,
    appUserId,
    dateKey,
    count: dailyUsage.count,
    payload: dailyUsage.payload,
    limit,
  };

  return {
    ok: true,
    actor: {
      userId: authenticatedUserId,
      usage,
      clerkUserId: authenticatedUserId,
      quota,
    },
  };
}

export async function recordSuccessfulRewriteUsage(context, _usage) {
  const quota = context?.actor?.quota;
  if (!quota?.appUserId || !quota?.dateKey) return;
  await writeDailyCount(quota.appUserId, quota.payload, quota.dateKey, quota.count + 1);
}
