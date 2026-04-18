import { sendJson, readJsonBody } from "../server/core/http.js";
import { requireProAccess } from "../server/core/requireProAccess.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function parseUrl(req) {
  const host = req.headers.host || "localhost";
  return new URL(req.url, `https://${host}`);
}

function parsePageSize(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function normalizeTurn(turn) {
  if (!turn || typeof turn !== "object") return null;
  const turnId = typeof turn.id === "string" ? turn.id.trim() : "";
  const role = turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : "";
  const sourceText = typeof turn.sourceText === "string" ? turn.sourceText : "";
  if (!turnId || !role) return null;
  if (role === "user" && !sourceText.trim()) return null;
  return {
    id: turnId,
    role,
    naturalVersion: typeof turn.naturalVersion === "string" ? turn.naturalVersion : null,
    reply: typeof turn.reply === "string" ? turn.reply : null,
    keyPhrases: Array.isArray(turn.keyPhrases) ? turn.keyPhrases.filter((item) => typeof item === "string") : [],
    sourceText: role === "user" ? (sourceText || null) : null,
    occurredAt: typeof turn.occurredAt === "string" ? turn.occurredAt : new Date().toISOString(),
    capturedAt: typeof turn.capturedAt === "string" ? turn.capturedAt : null,
    capturedDateKey: typeof turn.capturedDateKey === "string" ? turn.capturedDateKey : null,
    countsTowardLimit: typeof turn.countsTowardLimit === "boolean" ? turn.countsTowardLimit : null,
    adminDebug: typeof turn.adminDebug === "string" ? turn.adminDebug : null,
    usageDailyUsed: Number.isFinite(turn.usageDailyUsed) ? Number(turn.usageDailyUsed) : null,
    usageDailyLimit: Number.isFinite(turn.usageDailyLimit) ? Number(turn.usageDailyLimit) : null,
    proficiencyPhrase: typeof turn.proficiencyPhrase === "string" ? turn.proficiencyPhrase : null,
    proficiencyDelta: Number.isFinite(turn.proficiencyDelta) ? Number(turn.proficiencyDelta) : null,
    proficiencyScore: Number.isFinite(turn.proficiencyScore) ? Number(turn.proficiencyScore) : null,
    phraseClientVersion: Number.isFinite(turn.phraseClientVersion) ? Number(turn.phraseClientVersion) : null,
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;
  const id = typeof session.id === "string" ? session.id.trim() : "";
  if (!id) return null;
  if (session.kind === "practice") return null;
  const createdAt = typeof session.createdAt === "string" ? session.createdAt : new Date().toISOString();
  const updatedAt = typeof session.updatedAt === "string" ? session.updatedAt : createdAt;
  const title = typeof session.title === "string" && session.title.trim() ? session.title.trim() : "New conversation";
  const dateKey = typeof session.dateKey === "string" && session.dateKey.trim() ? session.dateKey.trim() : createdAt.slice(0, 10);
  const turns = Array.isArray(session.turns) ? session.turns.map(normalizeTurn).filter(Boolean) : [];
  return {
    id,
    createdAt,
    updatedAt,
    title,
    dateKey,
    turns,
  };
}

async function loadTurnsBySessionIds(supabase, appUserId, sessionIds) {
  if (!sessionIds.length) return new Map();
  const { data, error } = await supabase
    .from("chat_turns")
    .select("*")
    .eq("user_id", appUserId)
    .in("session_id", sessionIds)
    .order("occurred_at", { ascending: true });
  if (error) throw error;
  const grouped = new Map();
  for (const row of data ?? []) {
    const bucket = grouped.get(row.session_id) ?? [];
    bucket.push({
      id: row.turn_id,
      role: row.role,
      naturalVersion: row.natural_version ?? undefined,
      reply: row.reply ?? undefined,
      keyPhrases: Array.isArray(row.key_phrases) ? row.key_phrases.filter((item) => typeof item === "string") : [],
      sourceText: row.source_text ?? undefined,
      occurredAt: row.occurred_at ?? undefined,
      capturedAt: row.captured_at ?? undefined,
      capturedDateKey: row.captured_date_key ?? undefined,
      countsTowardLimit: typeof row.counts_toward_limit === "boolean" ? row.counts_toward_limit : undefined,
      adminDebug: row.admin_debug ?? undefined,
      usageDailyUsed: Number.isFinite(row.usage_daily_used) ? Number(row.usage_daily_used) : undefined,
      usageDailyLimit: Number.isFinite(row.usage_daily_limit) ? Number(row.usage_daily_limit) : undefined,
      proficiencyPhrase: typeof row.proficiency_phrase === "string" ? row.proficiency_phrase : undefined,
      proficiencyDelta: Number.isFinite(row.proficiency_delta) ? Number(row.proficiency_delta) : undefined,
      proficiencyScore: Number.isFinite(row.proficiency_score) ? Number(row.proficiency_score) : undefined,
      phraseClientVersion: Number.isFinite(row.phrase_client_version) ? Number(row.phrase_client_version) : undefined,
    });
    grouped.set(row.session_id, bucket);
  }
  return grouped;
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
      .from("chat_sessions")
      .select("session_id,title,date_key,created_at,updated_at")
      .eq("user_id", auth.appUserId)
      .order("updated_at", { ascending: false })
      .limit(limit + 1);
    if (before) query = query.lt("updated_at", before);
    const result = await query;
    if (result.error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to load chat history." } });
      return;
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const sessionIds = pageRows.map((row) => row.session_id).filter(Boolean);

    let turnMap;
    try {
      turnMap = await loadTurnsBySessionIds(supabase, auth.appUserId, sessionIds);
    } catch {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to load chat history." } });
      return;
    }

    const sessions = pageRows.map((row) => ({
      id: row.session_id,
      title: row.title,
      dateKey: row.date_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turns: turnMap.get(row.session_id) ?? [],
    }));

    const nextBefore = hasMore
      ? (typeof pageRows[pageRows.length - 1]?.updated_at === "string" ? pageRows[pageRows.length - 1].updated_at : null)
      : null;
    sendJson(res, 200, { sessions, has_more: hasMore, next_before: nextBefore });
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

    const sessions = Array.isArray(body?.sessions) ? body.sessions.map(normalizeSession).filter(Boolean) : [];
    const nextSessionIds = new Set(sessions.map((session) => session.id));

    const existingResult = await supabase
      .from("chat_sessions")
      .select("session_id")
      .eq("user_id", auth.appUserId);
    if (existingResult.error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
      return;
    }
    const existingIds = Array.isArray(existingResult.data) ? existingResult.data.map((row) => row.session_id).filter(Boolean) : [];
    const toDelete = existingIds.filter((id) => !nextSessionIds.has(id));
    if (toDelete.length > 0) {
      const deleteResult = await supabase
        .from("chat_sessions")
        .delete()
        .eq("user_id", auth.appUserId)
        .in("session_id", toDelete);
      if (deleteResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
        return;
      }
    }

    const sessionRows = sessions.map((session) => ({
      user_id: auth.appUserId,
      session_id: session.id,
      title: session.title,
      date_key: session.dateKey,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    }));
    if (sessionRows.length > 0) {
      const upsertSessionResult = await supabase
        .from("chat_sessions")
        .upsert(sessionRows, { onConflict: "user_id,session_id" });
      if (upsertSessionResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
        return;
      }
    }

    const sessionIds = sessions.map((session) => session.id);
    if (sessionIds.length > 0) {
      const deleteTurnsResult = await supabase
        .from("chat_turns")
        .delete()
        .eq("user_id", auth.appUserId)
        .in("session_id", sessionIds);
      if (deleteTurnsResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
        return;
      }
    }

    const turnRows = [];
    for (const session of sessions) {
      for (const turn of session.turns) {
        turnRows.push({
          user_id: auth.appUserId,
          session_id: session.id,
          turn_id: turn.id,
          role: turn.role,
          natural_version: turn.naturalVersion,
          reply: turn.reply,
          key_phrases: Array.isArray(turn.keyPhrases) ? turn.keyPhrases : [],
          source_text: turn.role === "user" ? (turn.sourceText ?? "") : null,
          occurred_at: turn.occurredAt ?? session.updatedAt ?? new Date().toISOString(),
          captured_at: turn.capturedAt,
          captured_date_key: turn.capturedDateKey,
          counts_toward_limit: turn.countsTowardLimit,
          admin_debug: turn.adminDebug,
          usage_daily_used: turn.usageDailyUsed,
          usage_daily_limit: turn.usageDailyLimit,
          proficiency_phrase: turn.proficiencyPhrase ?? null,
          proficiency_delta: Number.isFinite(turn.proficiencyDelta) ? Number(turn.proficiencyDelta) : null,
          proficiency_score: Number.isFinite(turn.proficiencyScore) ? Number(turn.proficiencyScore) : null,
          phrase_client_version: Number.isFinite(turn.phraseClientVersion) ? Number(turn.phraseClientVersion) : null,
        });
      }
    }
    if (turnRows.length > 0) {
      const upsertTurnsResult = await supabase
        .from("chat_turns")
        .upsert(turnRows, { onConflict: "user_id,session_id,turn_id" });
      if (upsertTurnsResult.error) {
        sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save chat history." } });
        return;
      }
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST /api/sync-chat." } });
}
