/** Allowlisted client observations, never authoritative purchase/entitlement evidence. */
export function sanitizeGoogleBillingDiagnostic(input: unknown): Record<string, string | number | null> | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (!["request", "callback", "products"].includes(String(value.stage))) return null;
  const result: Record<string, string | number | null> = { stage: String(value.stage) };
  for (const key of ["code", "productId", "basePlanId", "appVersion", "buildNumber", "runtimeVersion", "updateId", "channel"]) {
    const raw = value[key];
    result[key] = typeof raw === "string" && /^[\w.:-]{1,100}$/.test(raw) ? raw : null;
  }
  for (const key of ["responseCode", "subResponseCode"]) {
    const raw = value[key];
    result[key] = typeof raw === "number" && Number.isInteger(raw) && Math.abs(raw) < 10000 ? raw : null;
  }
  for (const key of ["message", "debugMessage"]) {
    const raw = value[key];
    result[key] = typeof raw === "string" ? raw
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
      .replace(/(token|receipt|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .replace(/[A-Za-z0-9_+\/.=-]{40,}/g, "[redacted]")
      .slice(0, 400) : null;
  }
  return result;
}
