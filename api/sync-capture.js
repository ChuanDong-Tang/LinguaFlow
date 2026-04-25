import { sendJson, readJsonBody } from "../server/core/http.js";
import { requireProAccess } from "../server/core/requireProAccess.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

function normalizeDateKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhraseDisplay(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizePhraseKey(value) {
  return normalizePhraseDisplay(value).toLowerCase();
}

function normalizeCaptureItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const chatSessionId = typeof item.chatSessionId === "string" ? item.chatSessionId.trim() : "";
  const chatTurnId = typeof item.chatTurnId === "string" ? item.chatTurnId.trim() : "";
  if (!id || !chatSessionId || !chatTurnId) return null;
  const keyPhrases = Array.isArray(item.keyPhrases)
    ? item.keyPhrases
      .map((value) => String(value ?? "").trim().replace(/\s+/g, " "))
      .filter(Boolean)
      //.slice(0, 3)
    : [];
  const practiceBlankIndexes = Array.isArray(item.practiceBlankIndexes)
    ? item.practiceBlankIndexes
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .map((value) => Math.floor(value))
    : [];
  const practiceCorrectBlankIndexes = Array.isArray(item.practiceCorrectBlankIndexes)
    ? item.practiceCorrectBlankIndexes
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .map((value) => Math.floor(value))
    : [];
  return {
    id,
    chatSessionId,
    chatTurnId,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    sourceText: typeof item.sourceText === "string" ? item.sourceText : "",
    naturalVersion: typeof item.naturalVersion === "string" ? item.naturalVersion : "",
    reply: typeof item.reply === "string" ? item.reply : "",
    keyPhrases,
    practiceBlankIndexes,
    practiceCorrectBlankIndexes,
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
    .select("capture_id,date_key,chat_session_id,chat_turn_id,created_at,source_text,natural_version,reply,key_phrases")
    .eq("user_id", appUserId)
    .eq("date_key", dateKey)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return null;
  const captureIds = rows
    .map((row) => (typeof row.capture_id === "string" ? row.capture_id : ""))
    .filter(Boolean);
  const blankIndexesByCaptureId = new Map();
  if (captureIds.length) {
    let stateRows = [];
    let stateError = null;
    {
      const result = await supabase
        .from("daily_capture_practice_state")
        .select("capture_id,blank_indexes,correct_blank_indexes")
        .eq("user_id", appUserId)
        .in("capture_id", captureIds);
      stateRows = result.data ?? [];
      stateError = result.error ?? null;
    }
    if (stateError) {
      const fallback = await supabase
        .from("daily_capture_practice_state")
        .select("capture_id,blank_indexes")
        .eq("user_id", appUserId)
        .in("capture_id", captureIds);
      stateRows = fallback.data ?? [];
      stateError = fallback.error ?? null;
    }
    if (stateError) throw stateError;
    for (const stateRow of stateRows ?? []) {
      const captureId = typeof stateRow.capture_id === "string" ? stateRow.capture_id : "";
      if (!captureId) continue;
      const normalizedBlankIndexes = Array.isArray(stateRow.blank_indexes)
        ? stateRow.blank_indexes
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .map((value) => Math.floor(value))
        : [];
      const normalizedCorrectBlankIndexes = Array.isArray(stateRow.correct_blank_indexes)
        ? stateRow.correct_blank_indexes
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .map((value) => Math.floor(value))
        : [];
      blankIndexesByCaptureId.set(captureId, {
        blankIndexes: normalizedBlankIndexes,
        correctBlankIndexes: normalizedCorrectBlankIndexes,
      });
    }
  }
  const updatedAt = rows[rows.length - 1]?.created_at ?? new Date().toISOString();
  return {
    dateKey,
    updatedAt,
    items: rows.map((row) => ({
      id: row.capture_id,
      chatSessionId: row.chat_session_id,
      chatTurnId: row.chat_turn_id,
      createdAt: row.created_at,
      sourceText: typeof row.source_text === "string" ? row.source_text : "",
      naturalVersion: typeof row.natural_version === "string" ? row.natural_version : "",
      reply: typeof row.reply === "string" ? row.reply : "",
      keyPhrases: Array.isArray(row.key_phrases) ? row.key_phrases.filter((value) => typeof value === "string") : [],
      practiceBlankIndexes: blankIndexesByCaptureId.get(row.capture_id)?.blankIndexes ?? [],
      practiceCorrectBlankIndexes: blankIndexesByCaptureId.get(row.capture_id)?.correctBlankIndexes ?? [],
    })),
  };
}

async function replaceRecordItems(supabase, appUserId, record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return;
  const dateKey = normalized.dateKey;
  if (!normalized.items.length) return;
  const rows = normalized.items.map((item) => ({
    user_id: appUserId,
    capture_id: item.id,
    date_key: dateKey,
    chat_session_id: item.chatSessionId,
    chat_turn_id: item.chatTurnId,
    created_at: item.createdAt || normalized.updatedAt || new Date().toISOString(),
    source_text: item.sourceText || null,
    natural_version: item.naturalVersion || null,
    reply: item.reply || null,
    key_phrases: item.keyPhrases,
  }));
  const { error: insertError } = await supabase
    .from("daily_capture_items")
    .upsert(rows, { onConflict: "user_id,capture_id" });
  if (insertError) throw insertError;
  await seedUserPhraseProficiencyFromCaptureItems(supabase, appUserId, normalized.items);

  const stateRows = normalized.items.map((item) => ({
    user_id: appUserId,
    capture_id: item.id,
    blank_indexes: item.practiceBlankIndexes,
    correct_blank_indexes: item.practiceCorrectBlankIndexes,
    updated_at: normalized.updatedAt || new Date().toISOString(),
  }));
  let stateUpsertError = null;
  {
    const result = await supabase
      .from("daily_capture_practice_state")
      .upsert(stateRows, { onConflict: "user_id,capture_id" });
    stateUpsertError = result.error ?? null;
  }
  if (stateUpsertError) {
    const fallbackStateRows = normalized.items.map((item) => ({
      user_id: appUserId,
      capture_id: item.id,
      blank_indexes: item.practiceBlankIndexes,
      updated_at: normalized.updatedAt || new Date().toISOString(),
    }));
    const fallback = await supabase
      .from("daily_capture_practice_state")
      .upsert(fallbackStateRows, { onConflict: "user_id,capture_id" });
    stateUpsertError = fallback.error ?? null;
  }
  if (stateUpsertError) throw stateUpsertError;
}

async function seedUserPhraseProficiencyFromCaptureItems(supabase, appUserId, items) {
  const deduped = new Map();
  for (const item of items) {
    const phrases = Array.isArray(item?.keyPhrases) ? item.keyPhrases : [];
    for (const rawPhrase of phrases) {
      const phraseDisplay = normalizePhraseDisplay(rawPhrase);
      const phraseNorm = normalizePhraseKey(rawPhrase);
      if (!phraseDisplay || !phraseNorm) continue;
      if (!deduped.has(phraseNorm)) {
        deduped.set(phraseNorm, phraseDisplay);
      }
    }
  }
  if (!deduped.size) return;

  const now = new Date().toISOString();
  const rows = Array.from(deduped.entries()).map(([phraseNorm, phraseDisplay]) => ({
    user_id: appUserId,
    phrase_norm: phraseNorm,
    phrase_display: phraseDisplay,
    updated_at: now,
  }));

  const { error } = await supabase
    .from("user_phrase_proficiency")
    .upsert(rows, { onConflict: "user_id,phrase_norm", ignoreDuplicates: true });
  if (error) throw error;
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

  if (req.method === "DELETE") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
      return;
    }

    const captureIds = Array.isArray(body?.captureIds)
      ? body.captureIds
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
      : [];
    if (!captureIds.length) {
      sendJson(res, 400, { error: { code: "INVALID_CAPTURE_IDS", message: "captureIds must contain at least one id." } });
      return;
    }

    try {
      const deleteStateResult = await supabase
        .from("daily_capture_practice_state")
        .delete()
        .eq("user_id", auth.appUserId)
        .in("capture_id", captureIds);
      if (deleteStateResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to delete capture records." } });
        return;
      }

      const deleteItemsResult = await supabase
        .from("daily_capture_items")
        .delete()
        .eq("user_id", auth.appUserId)
        .in("capture_id", captureIds);
      if (deleteItemsResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to delete capture records." } });
        return;
      }

      sendJson(res, 200, { ok: true });
      return;
    } catch {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to delete capture records." } });
      return;
    }
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET, POST, or DELETE /api/sync-capture." } });
}
