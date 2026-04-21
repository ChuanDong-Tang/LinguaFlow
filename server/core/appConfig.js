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
  const freeDailyCharLimit = parsePositiveInteger(process.env.APP_FREE_DAILY_CHAR_LIMIT, 3600);
  const proDailyCharLimit = parsePositiveInteger(process.env.APP_PRO_DAILY_CHAR_LIMIT, 24000);
  return {
    clerkSecretKey: process.env.CLERK_SECRET_KEY ?? "",
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    adminClerkUserIds: parseCsv(process.env.APP_ADMIN_CLERK_USER_IDS),
    adminEmails: parseCsv(process.env.APP_ADMIN_EMAILS).map((item) => item.toLowerCase()),
    proPlanCode: process.env.APP_PRO_PLAN_CODE ?? "pro_monthly",
    freeDailyCharLimit,
    proDailyCharLimit,
  };
}
