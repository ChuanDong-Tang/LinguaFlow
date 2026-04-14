function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return value === "true";
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAppConfig() {
  return {
    clerkSecretKey: process.env.CLERK_SECRET_KEY ?? "",
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    adminClerkUserIds: parseCsv(process.env.APP_ADMIN_CLERK_USER_IDS),
    adminEmails: parseCsv(process.env.APP_ADMIN_EMAILS).map((item) => item.toLowerCase()),
    proPlanCode: process.env.APP_PRO_PLAN_CODE ?? "pro_monthly",
    allowAnonymousRewrite: parseBoolean(process.env.APP_ALLOW_ANONYMOUS_REWRITE, true),
    freeDailyReplyLimit: parsePositiveInteger(process.env.APP_FREE_DAILY_REPLY_LIMIT, 3),
    proDailyReplyLimit: parsePositiveInteger(process.env.APP_PRO_DAILY_REPLY_LIMIT, 20),
  };
}
