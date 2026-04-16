import { authenticateClerkRequest } from "../core/auth.js";
import { getAppConfig } from "../core/appConfig.js";
import { getViewerAccessByClerkUserId } from "./access.js";
import { getSupabaseAdmin } from "../infrastructure/supabase.js";

function toUtcDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readDailyCount(appUserId, dateKey) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rewrite_daily_usage")
    .select("used_chars")
    .eq("user_id", appUserId)
    .eq("date_key", dateKey)
    .maybeSingle();
  if (error) throw error;
  const count = Number.parseInt(String(data?.used_chars ?? "0"), 10);
  return {
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
    daily_limit: hasPro ? config.proDailyCharLimit : config.freeDailyCharLimit,
  };
}

async function writeDailyCount(appUserId, dateKey, count) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("rewrite_daily_usage")
    .upsert(
      {
        user_id: appUserId,
        date_key: dateKey,
        used_chars: Math.max(0, Math.floor(count)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date_key" },
    );
  if (error) throw error;
}

export async function getRewriteAccessContext(req, config, mode = "beginner") {
  const auth = await authenticateClerkRequest(req, { requireAuth: true });
  if (!auth.ok) {
    return {
      ok: false,
      code: auth.code,
      message: auth.message,
    };
  }

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
  const limit = hasPro ? appConfig.proDailyCharLimit : appConfig.freeDailyCharLimit;
  const dateKey = toUtcDateKey();
  const dailyUsage = await readDailyCount(appUserId, dateKey);
  if (dailyUsage.count >= limit) {
    return {
      ok: false,
      status: 429,
      code: "DAILY_LIMIT_REACHED",
      message: `Daily AI character limit reached (${limit}).`,
    };
  }
  const quota = {
    mode,
    appUserId,
    dateKey,
    count: dailyUsage.count,
    limit,
  };

  return {
    ok: true,
    actor: {
      userId: authenticatedUserId,
      clerkUserId: authenticatedUserId,
      quota,
    },
  };
}

export async function recordSuccessfulRewriteUsage(context, usage) {
  const quota = context?.actor?.quota;
  if (!quota?.appUserId || !quota?.dateKey) return;
  const inputChars = Math.max(0, Number(usage?.inputChars) || 0);
  const outputChars = Math.max(0, Number(usage?.outputChars) || 0);
  const chargedChars = inputChars + outputChars;
  if (chargedChars <= 0) return;
  await writeDailyCount(quota.appUserId, quota.dateKey, quota.count + chargedChars);
}
