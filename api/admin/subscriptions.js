import { getAppConfig } from "../core/appConfig.js";
import { readJsonBody, sendJson } from "../core/http.js";
import { activateManualSubscription } from "../services/access.js";
import { requireAdminRequest } from "../services/admin.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST /api/admin/subscriptions." } });
    return;
  }

  const admin = await requireAdminRequest(req, res);
  if (!admin) return;
  const config = getAppConfig();

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    return;
  }

  const clerkUserId = typeof body?.clerkUserId === "string" ? body.clerkUserId.trim() : "";
  const months = Number.isFinite(body?.months) ? Number(body.months) : 1;
  const planCode = typeof body?.planCode === "string" && body.planCode.trim() ? body.planCode.trim() : config.proPlanCode;

  if (!clerkUserId || !/^user_[a-zA-Z0-9]+$/.test(clerkUserId)) {
    sendJson(res, 400, { error: { code: "INVALID_INPUT", message: "clerkUserId is required." } });
    return;
  }

  if (!Number.isInteger(months) || months < 1 || months > 12) {
    sendJson(res, 400, { error: { code: "INVALID_INPUT", message: "months must be an integer between 1 and 12." } });
    return;
  }

  try {
    const viewer = await activateManualSubscription({
      clerkUserId,
      actorClerkUserId: admin.clerkUserId,
      planCode,
      months,
      source: "manual_admin",
    });

    sendJson(res, 200, { viewer });
  } catch (error) {
    console.error("[admin/subscriptions] Failed to activate manual subscription:", error);
    sendJson(res, 500, { error: { code: "SUBSCRIPTION_ACTIVATION_FAILED", message: "Could not activate the subscription." } });
  }
}
