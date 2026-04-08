function parseIntegerHeader(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getRewriteAccessContext(req, config) {
  const userId = String(req.headers["x-user-id"] ?? "").trim();
  if (config.requireUserId && !userId) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Sign in is required for rewrite access.",
    };
  }

  const usage = {
    dailyCalls: parseIntegerHeader(req.headers["x-rewrite-daily-calls"]),
    dailyChars: parseIntegerHeader(req.headers["x-rewrite-daily-chars"]),
    monthlyCalls: parseIntegerHeader(req.headers["x-rewrite-monthly-calls"]),
    monthlyChars: parseIntegerHeader(req.headers["x-rewrite-monthly-chars"]),
  };

  return {
    ok: true,
    actor: {
      userId: userId || "anonymous",
      usage,
    },
  };
}

export async function recordSuccessfulRewriteUsage(_context, _usage) {
  // Future account/subscription integration point:
  // persist successful call counts and character totals only after a valid response is produced.
}
