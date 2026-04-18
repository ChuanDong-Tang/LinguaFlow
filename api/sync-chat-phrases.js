import { sendJson, readJsonBody } from "../server/core/http.js";
import { requireProAccess } from "../server/core/requireProAccess.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

const MAX_UPDATES_PER_REQUEST = 50;
const MAX_PHRASES_PER_TURN = 3;
const MIN_PHRASE_WORDS = 2;
const MAX_PHRASE_WORDS = 8;

function normalizePhraseText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function countPhraseWords(value) {
  return normalizePhraseText(value).match(/\b[\w'-]+\b/g)?.length ?? 0;
}

function normalizeKeyPhrases(raw) {
  if (!Array.isArray(raw)) return [];
  const dedup = new Set();
  const output = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const phrase = normalizePhraseText(item);
    if (!phrase) continue;
    const words = countPhraseWords(phrase);
    if (words < MIN_PHRASE_WORDS || words > MAX_PHRASE_WORDS) continue;
    const phraseKey = phrase.toLowerCase();
    if (dedup.has(phraseKey)) continue;
    dedup.add(phraseKey);
    output.push(phrase);
    if (output.length >= MAX_PHRASES_PER_TURN) break;
  }
  return output;
}

function normalizePhraseUpdate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  const turnId = typeof raw.turnId === "string" ? raw.turnId.trim() : "";
  if (!sessionId || !turnId) return null;
  return {
    sessionId,
    turnId,
    keyPhrases: normalizeKeyPhrases(raw.keyPhrases),
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "PATCH") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use PATCH /api/sync-chat-phrases." } });
    return;
  }

  const auth = await requireProAccess(req, res);
  if (!auth) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    return;
  }

  const rawUpdates = Array.isArray(body?.updates) ? body.updates : [body];
  if (!rawUpdates.length || rawUpdates.length > MAX_UPDATES_PER_REQUEST) {
    sendJson(res, 400, {
      error: {
        code: "INVALID_UPDATES",
        message: `Provide 1-${MAX_UPDATES_PER_REQUEST} phrase updates per request.`,
      },
    });
    return;
  }

  const updates = rawUpdates.map(normalizePhraseUpdate).filter(Boolean);
  if (!updates.length) {
    sendJson(res, 400, { error: { code: "INVALID_UPDATES", message: "No valid phrase updates were found." } });
    return;
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const touchedSessionIds = new Set();

  for (const update of updates) {
    const result = await supabase
      .from("chat_turns")
      .update({ key_phrases: update.keyPhrases })
      .eq("user_id", auth.appUserId)
      .eq("session_id", update.sessionId)
      .eq("turn_id", update.turnId)
      .eq("role", "assistant")
      .select("turn_id")
      .maybeSingle();

    if (result.error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save phrase updates." } });
      return;
    }
    if (result.data?.turn_id) {
      touchedSessionIds.add(update.sessionId);
    }
  }

  for (const sessionId of touchedSessionIds) {
    const sessionUpdateResult = await supabase
      .from("chat_sessions")
      .update({ updated_at: nowIso })
      .eq("user_id", auth.appUserId)
      .eq("session_id", sessionId);
    if (sessionUpdateResult.error) {
      sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to bump chat session timestamp." } });
      return;
    }
  }

  sendJson(res, 200, { ok: true, updatedSessions: touchedSessionIds.size, acceptedUpdates: updates.length });
}
