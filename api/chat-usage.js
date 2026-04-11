import { authenticateClerkRequest } from "../server/core/auth.js";
import { sendJson } from "../server/core/http.js";
import { getRewriteUsageSnapshotByClerkUserId } from "../server/services/rewriteUsage.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET /api/chat-usage." } });
    return;
  }

  const auth = await authenticateClerkRequest(req, { requireAuth: false });
  if (!auth.ok) {
    sendJson(res, 401, { error: { code: auth.code, message: auth.message } });
    return;
  }

  if (!auth.clerkUserId) {
    sendJson(res, 200, { usage: null });
    return;
  }

  try {
    const usage = await getRewriteUsageSnapshotByClerkUserId(auth.clerkUserId);
    sendJson(res, 200, { usage });
  } catch (error) {
    console.error("[chat-usage] Failed to load usage snapshot:", error);
    sendJson(res, 500, { error: { code: "USAGE_LOAD_FAILED", message: "Could not load chat usage." } });
  }
}
