import { sendJson, readJsonBody } from "../server/core/http.js";
import { authenticateClerkRequest } from "../server/core/auth.js";
import { getViewerAccessByClerkUserId } from "../server/services/access.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

const RECORD_DOC_PREFIX = "daily_capture:";
const INDEX_TABLE = "daily_capture_index";

function toRecordDocType(dateKey) {
  return `${RECORD_DOC_PREFIX}${dateKey}`;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const dateKey = typeof record.dateKey === "string" ? record.dateKey.trim() : "";
  if (!dateKey) return null;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString();
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    ...record,
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

  return { access, appUserId: access.profile.appUserId };
}

async function loadCaptureIndex(supabase, appUserId) {
  const { data, error } = await supabase
    .from(INDEX_TABLE)
    .select("date_key,card_count,updated_at")
    .eq("user_id", appUserId)
    .order("date_key", { ascending: false });
  if (error) throw error;
  return Array.isArray(data)
    ? data.map((row) => ({
      dateKey: row.date_key,
      cardCount: Number(row.card_count) || 0,
      updatedAt: row.updated_at || "",
    }))
    : [];
}

async function loadRecordByDate(supabase, appUserId, dateKey) {
  const { data, error } = await supabase
    .from("user_cloud_documents")
    .select("payload")
    .eq("user_id", appUserId)
    .eq("doc_type", toRecordDocType(dateKey))
    .maybeSingle();
  if (error) throw error;
  return normalizeRecord(data?.payload);
}

async function upsertRecordAndIndex(supabase, appUserId, record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return;
  const now = new Date().toISOString();
  const cardCount = normalized.items.length;
  if (cardCount <= 0) {
    const [{ error: deleteRecordError }, { error: deleteIndexError }] = await Promise.all([
      supabase
        .from("user_cloud_documents")
        .delete()
        .eq("user_id", appUserId)
        .eq("doc_type", toRecordDocType(normalized.dateKey)),
      supabase
        .from(INDEX_TABLE)
        .delete()
        .eq("user_id", appUserId)
        .eq("date_key", normalized.dateKey),
    ]);
    if (deleteRecordError) throw deleteRecordError;
    if (deleteIndexError) throw deleteIndexError;
    return;
  }

  const [{ error: upsertRecordError }, { error: upsertIndexError }] = await Promise.all([
    supabase
      .from("user_cloud_documents")
      .upsert(
        {
          user_id: appUserId,
          doc_type: toRecordDocType(normalized.dateKey),
          payload: normalized,
          updated_at: normalized.updatedAt || now,
        },
        { onConflict: "user_id,doc_type" },
      ),
    supabase
      .from(INDEX_TABLE)
      .upsert(
        {
          user_id: appUserId,
          date_key: normalized.dateKey,
          card_count: cardCount,
          updated_at: normalized.updatedAt || now,
        },
        { onConflict: "user_id,date_key" },
      ),
  ]);
  if (upsertRecordError) throw upsertRecordError;
  if (upsertIndexError) throw upsertIndexError;
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
  const dateKey = url.searchParams.get("date")?.trim() ?? "";
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
        await upsertRecordAndIndex(supabase, auth.appUserId, body.record);
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
