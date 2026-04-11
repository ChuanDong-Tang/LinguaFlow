import { sendJson, readJsonBody } from "../server/core/http.js";
import { authenticateClerkRequest } from "../server/core/auth.js";
import { getViewerAccessByClerkUserId } from "../server/services/access.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

const SESSION_DOC_PREFIX = "chat_session:";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function toSessionDocType(sessionId) {
  return `${SESSION_DOC_PREFIX}${sessionId}`;
}

function fromSessionDocType(docType) {
  if (typeof docType !== "string" || !docType.startsWith(SESSION_DOC_PREFIX)) return "";
  return docType.slice(SESSION_DOC_PREFIX.length).trim();
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;
  const id = typeof session.id === "string" ? session.id.trim() : "";
  if (!id) return null;
  return session;
}

function parseUrl(req) {
  const host = req.headers.host || "localhost";
  return new URL(req.url, `https://${host}`);
}

function parsePageSize(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

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
  const url = parseUrl(req);

  if (req.method === "GET") {
    const limit = parsePageSize(url.searchParams.get("limit"));
    const before = url.searchParams.get("before")?.trim() ?? "";
    let query = supabase
      .from("user_cloud_documents")
      .select("doc_type,payload,updated_at")
      .eq("user_id", auth.appUserId)
      .like("doc_type", `${SESSION_DOC_PREFIX}%`)
      .order("updated_at", { ascending: false })
      .limit(limit + 1);
    if (before) {
      query = query.lt("updated_at", before);
    }
    const perSessionResult = await query;

    if (perSessionResult.error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to load chat history." } });
      return;
    }

    const perSessionRows = Array.isArray(perSessionResult.data) ? perSessionResult.data : [];
    const hasMore = perSessionRows.length > limit;
    const pageRows = hasMore ? perSessionRows.slice(0, limit) : perSessionRows;
    const normalizedSessions = pageRows
      .map((row) => {
        const payload = normalizeSession(row?.payload);
        if (!payload) return null;
        const sessionId = fromSessionDocType(row?.doc_type);
        if (!sessionId) return null;
        if (payload.id !== sessionId) {
          payload.id = sessionId;
        }
        return payload;
      })
      .filter(Boolean);
    const nextBefore = hasMore
      ? (typeof pageRows[pageRows.length - 1]?.updated_at === "string" ? pageRows[pageRows.length - 1].updated_at : null)
      : null;
    sendJson(res, 200, { sessions: normalizedSessions, has_more: hasMore, next_before: nextBefore });
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

    const sessions = Array.isArray(body?.sessions)
      ? body.sessions.map(normalizeSession).filter(Boolean)
      : [];
    const now = new Date().toISOString();
    const nextDocTypes = new Set(sessions.map((session) => toSessionDocType(session.id)));
    const existingRowsResult = await supabase
      .from("user_cloud_documents")
      .select("doc_type")
      .eq("user_id", auth.appUserId)
      .like("doc_type", `${SESSION_DOC_PREFIX}%`);
    if (existingRowsResult.error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
      return;
    }
    const existingDocTypes = Array.isArray(existingRowsResult.data)
      ? existingRowsResult.data
          .map((row) => (typeof row?.doc_type === "string" ? row.doc_type : ""))
          .filter(Boolean)
      : [];
    const docTypesToDelete = existingDocTypes.filter((docType) => !nextDocTypes.has(docType));

    if (sessions.length > 0) {
      const rows = sessions.map((session) => ({
        user_id: auth.appUserId,
        doc_type: toSessionDocType(session.id),
        payload: session,
        updated_at: typeof session.updatedAt === "string" && session.updatedAt.trim() ? session.updatedAt : now,
      }));
      const upsertResult = await supabase
        .from("user_cloud_documents")
        .upsert(rows, { onConflict: "user_id,doc_type" });
      if (upsertResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
        return;
      }
    }

    if (docTypesToDelete.length > 0) {
      const deleteResult = await supabase
        .from("user_cloud_documents")
        .delete()
        .eq("user_id", auth.appUserId)
        .in("doc_type", docTypesToDelete);
      if (deleteResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
        return;
      }
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST /api/sync-chat." } });
}
