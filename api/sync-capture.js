import { sendJson, readJsonBody } from "../server/core/http.js";
import { authenticateClerkRequest } from "../server/core/auth.js";
import { getViewerAccessByClerkUserId } from "../server/services/access.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

function normalizeDateKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCaptureItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const chatSessionId = typeof item.chatSessionId === "string" ? item.chatSessionId.trim() : "";
  const chatTurnId = typeof item.chatTurnId === "string" ? item.chatTurnId.trim() : "";
  if (!id || !chatSessionId || !chatTurnId) return null;
  return {
    id,
    chatSessionId,
    chatTurnId,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
  };
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const dateKey = normalizeDateKey(record.dateKey);
  if (!dateKey) return null;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString();
  const items = Array.isArray(record.items)
    ? record.items.map(normalizeCaptureItem).filter(Boolean)
    : [];
  return {
    dateKey,
    updatedAt,
    items,
  };
}

function parseUrl(req) {
  const host = req.headers.host || "localhost";
  return new URL(req.url, `https://${host}`);
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

  return { appUserId: access.profile.appUserId };
}

async function loadCaptureIndex(supabase, appUserId) {
  const { data, error } = await supabase
    .from("daily_capture_items")
    .select("date_key,created_at")
    .eq("user_id", appUserId)
    .order("date_key", { ascending: false });
  if (error) throw error;
  const aggregate = new Map();
  for (const row of data ?? []) {
    const dateKey = row.date_key;
    if (!dateKey) continue;
    const existing = aggregate.get(dateKey) ?? { cardCount: 0, updatedAt: "" };
    existing.cardCount += 1;
    if (typeof row.created_at === "string" && row.created_at > existing.updatedAt) {
      existing.updatedAt = row.created_at;
    }
    aggregate.set(dateKey, existing);
  }
  return Array.from(aggregate.entries())
    .map(([dateKey, value]) => ({ dateKey, cardCount: value.cardCount, updatedAt: value.updatedAt }))
    .sort((left, right) => (left.dateKey < right.dateKey ? 1 : -1));
}

async function loadRecordByDate(supabase, appUserId, dateKey) {
  const { data, error } = await supabase
    .from("daily_capture_items")
    .select("capture_id,date_key,chat_session_id,chat_turn_id,created_at")
    .eq("user_id", appUserId)
    .eq("date_key", dateKey)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return null;
  const updatedAt = rows[rows.length - 1]?.created_at ?? new Date().toISOString();
  return {
    dateKey,
    updatedAt,
    items: rows.map((row) => ({
      id: row.capture_id,
      chatSessionId: row.chat_session_id,
      chatTurnId: row.chat_turn_id,
      createdAt: row.created_at,
    })),
  };
}

async function replaceRecordItems(supabase, appUserId, record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return;
  const dateKey = normalized.dateKey;
  const { error: deleteError } = await supabase
    .from("daily_capture_items")
    .delete()
    .eq("user_id", appUserId)
    .eq("date_key", dateKey);
  if (deleteError) throw deleteError;
  if (!normalized.items.length) return;
  const rows = normalized.items.map((item) => ({
    user_id: appUserId,
    capture_id: item.id,
    date_key: dateKey,
    chat_session_id: item.chatSessionId,
    chat_turn_id: item.chatTurnId,
    created_at: item.createdAt || normalized.updatedAt || new Date().toISOString(),
  }));
  const { error: insertError } = await supabase
    .from("daily_capture_items")
    .upsert(rows, { onConflict: "user_id,capture_id" });
  if (insertError) throw insertError;
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
  const dateKey = normalizeDateKey(url.searchParams.get("date"));
  const view = url.searchParams.get("view")?.trim() ?? "";

  if (req.method === "GET") {
    try {
      if (dateKey) {
        const record = await loadRecordByDate(supabase, auth.appUserId, dateKey);
        sendJson(res, 200, { record: record ?? null });
        return;
      }
      if (view !== "index") {
        sendJson(res, 400, { error: { code: "INVALID_QUERY", message: "Use ?view=index or ?date=YYYY-MM-DD." } });
        return;
      }
      const index = await loadCaptureIndex(supabase, auth.appUserId);
      sendJson(res, 200, { index });
      return;
    } catch {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to load capture records." } });
      return;
    }
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
      return;
    }

    try {
      if (body?.record && typeof body.record === "object") {
        await replaceRecordItems(supabase, auth.appUserId, body.record);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 400, { error: { code: "INVALID_PAYLOAD", message: "Request body must include a record object." } });
      return;
    } catch {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save capture records." } });
      return;
    }
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST /api/sync-capture." } });
}
