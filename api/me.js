import { getAppConfig } from "./core/appConfig.js";
import { authenticateClerkRequest } from "./core/auth.js";
import { sendJson } from "./core/http.js";
import { createAnonymousViewerAccess, getViewerAccessByClerkUserId } from "./services/access.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET /api/me." } });
    return;
  }

  const config = getAppConfig();
  const auth = await authenticateClerkRequest(req, { requireAuth: false });
  if (!auth.ok) {
    sendJson(res, 401, { error: { code: auth.code, message: auth.message } });
    return;
  }

  if (!auth.clerkUserId) {
    sendJson(res, 200, {
      viewer: {
        ...createAnonymousViewerAccess(),
        permissions: {
          ...createAnonymousViewerAccess().permissions,
          canUseRewrite: config.allowAnonymousRewrite,
        },
      },
    });
    return;
  }

  try {
    const viewer = await getViewerAccessByClerkUserId(auth.clerkUserId);
    sendJson(res, 200, { viewer });
  } catch (error) {
    console.error("[me] Failed to load viewer access:", error);
    sendJson(res, 500, { error: { code: "ACCESS_LOAD_FAILED", message: "Could not load viewer access." } });
  }
}
