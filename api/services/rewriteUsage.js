import { getAppConfig } from "../core/appConfig.js";
import { authenticateClerkRequest } from "../core/auth.js";
import { getViewerAccessByClerkUserId } from "./access.js";
import { getSupabaseAdmin } from "../infrastructure/supabase.js";

function parseIntegerHeader(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

const REWRITE_USAGE_DOC_TYPE = "rewrite_usage_daily";
const PRO_DAILY_REPLY_LIMIT = 20;

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

  const viewer = await getViewerAccessByClerkUserId(clerkUserId);
  const hasPro = viewer.entitlements.some((item) => item.active && item.code === "pro_access");
  const appUserId = viewer.profile?.appUserId ?? "";
  if (!hasPro || !appUserId) return null;

  const dateKey = toUtcDateKey();
  const usage = await readDailyCount(appUserId, dateKey);
  return {
    daily_used: Math.max(0, Number(usage.count) || 0),
    daily_limit: PRO_DAILY_REPLY_LIMIT,
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
  const appConfig = getAppConfig();
  const auth = await authenticateClerkRequest(req, { requireAuth: config.requireUserId });
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
  if (config.requireUserId && !authenticatedUserId) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Sign in is required for rewrite access.",
    };
  }

  let quota = null;
  if (authenticatedUserId) {
    const viewer = await getViewerAccessByClerkUserId(authenticatedUserId);
    const hasPro = viewer.entitlements.some((item) => item.active && item.code === "pro_access");
    const appUserId = viewer.profile?.appUserId ?? "";
    if (hasPro && appUserId) {
      const dateKey = toUtcDateKey();
      const usage = await readDailyCount(appUserId, dateKey);
      if (usage.count >= PRO_DAILY_REPLY_LIMIT) {
        return {
          ok: false,
          status: 429,
          code: "DAILY_LIMIT_REACHED",
          message: `Daily AI reply limit reached (${PRO_DAILY_REPLY_LIMIT}).`,
        };
      }
      quota = {
        mode,
        appUserId,
        dateKey,
        count: usage.count,
        payload: usage.payload,
        limit: PRO_DAILY_REPLY_LIMIT,
      };
    }
  }

  return {
    ok: true,
    actor: {
      userId: authenticatedUserId || (appConfig.allowAnonymousRewrite ? "anonymous" : "guest"),
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
