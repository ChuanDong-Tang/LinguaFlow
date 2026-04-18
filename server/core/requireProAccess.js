import { sendJson } from "./http.js";
import { authenticateClerkRequest } from "./auth.js";
import { getViewerAccessByClerkUserId } from "../services/access.js";
import { hasActiveProAccess } from "../services/entitlements/proAccess.js";

export async function requireProAccess(req, res) {
  const auth = await authenticateClerkRequest(req, { requireAuth: true });
  if (!auth.ok || !auth.clerkUserId) {
    sendJson(res, 401, { error: { code: auth.code ?? "UNAUTHORIZED", message: auth.message ?? "Sign in required." } });
    return null;
  }

  const access = await getViewerAccessByClerkUserId(auth.clerkUserId);
  if (!hasActiveProAccess(access) || !access.profile?.appUserId) {
    sendJson(res, 403, { error: { code: "PRO_REQUIRED", message: "Pro subscription required." } });
    return null;
  }

  return {
    appUserId: access.profile.appUserId,
    clerkUserId: auth.clerkUserId,
    access,
  };
}

