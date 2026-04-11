import { authenticateClerkRequest, getClerkUser } from "../core/auth.js";
import { sendJson } from "../core/http.js";
import { getAppConfig } from "../core/appConfig.js";

export async function requireAdminRequest(req, res) {
  const auth = await authenticateClerkRequest(req, { requireAuth: true });
  if (!auth.ok || !auth.clerkUserId) {
    sendJson(res, 401, { error: { code: auth.code || "UNAUTHORIZED", message: auth.message || "Sign in is required." } });
    return null;
  }

  const config = getAppConfig();
  const clerkUser = await getClerkUser(auth.clerkUserId);
  const primaryEmail = clerkUser?.primaryEmailAddress?.emailAddress?.toLowerCase()
    || clerkUser?.emailAddresses?.[0]?.emailAddress?.toLowerCase()
    || "";
  const isAdmin = config.adminClerkUserIds.includes(auth.clerkUserId)
    || (!!primaryEmail && config.adminEmails.includes(primaryEmail));

  if (!isAdmin) {
    sendJson(res, 403, { error: { code: "FORBIDDEN", message: "Admin access is required." } });
    return null;
  }

  return {
    clerkUserId: auth.clerkUserId,
    email: primaryEmail || null,
  };
}
