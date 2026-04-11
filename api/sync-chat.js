import { sendJson, readJsonBody } from "../server/core/http.js";
import { authenticateClerkRequest } from "../server/core/auth.js";
import { getViewerAccessByClerkUserId } from "../server/services/access.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

const DOC_TYPE = "chat_sessions";

async function requireProAccess(req, res) {
  const auth = await authenticateClerkRequest(req, { requireAuth: true });
  if (!auth.ok || !auth.clerkUserId) {
    sendJson(res, 401, { error: { code: auth.code ?? "UNAUTHORIZED", message: auth.message ?? "Sign in required." } });
    return null;
  }

  const access = await getViewerAccessByClerkUserId(auth.clerkUserId);
  const hasPro = access.entitlements.some((item) => item.active && item.code === "pro_access");
  if (!hasPro || !access.profile?.appUserId) {
    sendJson(res, 403, { error: { code: "PRO_REQUIRED", message: "Pro subscription required." } });
    return null;
  }

  return { access, appUserId: access.profile.appUserId };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const auth = await requireProAccess(req, res);
  if (!auth) return;

  const supabase = getSupabaseAdmin();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("user_cloud_documents")
      .select("payload")
      .eq("user_id", auth.appUserId)
      .eq("doc_type", DOC_TYPE)
      .maybeSingle();

    if (error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to load chat history." } });
      return;
    }

    sendJson(res, 200, { sessions: data?.payload ?? [] });
    return;
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
      return;
    }

    const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
    const { error } = await supabase
      .from("user_cloud_documents")
      .upsert(
        {
          user_id: auth.appUserId,
          doc_type: DOC_TYPE,
          payload: sessions,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,doc_type" },
      );

    if (error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST /api/sync-chat." } });
}
