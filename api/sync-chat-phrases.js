import { sendJson, readJsonBody } from "../server/core/http.js";
import { requireProAccess } from "../server/core/requireProAccess.js";
import { getSupabaseAdmin } from "../server/infrastructure/supabase.js";

const MAX_UPDATES_PER_REQUEST = 50;
const MAX_PHRASES_PER_TURN = 999;
const MIN_PHRASE_WORDS = 1;
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
    //if (words < MIN_PHRASE_WORDS || words > MAX_PHRASE_WORDS) continue;
    if (words < MIN_PHRASE_WORDS) continue;
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
  const clientVersion = Number.isFinite(raw.clientVersion)
    ? Math.floor(Number(raw.clientVersion))
    : Number.isFinite(raw.client_version)
      ? Math.floor(Number(raw.client_version))
      : 0;
  if (!sessionId || !turnId) return null;
  if (clientVersion <= 0) return null;
  return {
    sessionId,
    turnId,
    keyPhrases: normalizeKeyPhrases(raw.keyPhrases),
    clientVersion,
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
  const rpcPayload = updates.map((update) => ({
    session_id: update.sessionId,
    turn_id: update.turnId,
    key_phrases: update.keyPhrases,
    client_version: update.clientVersion,
  }));
  const rpcResult = await supabase.rpc("apply_chat_phrase_updates", {
    p_user_id: auth.appUserId,
    p_updates: rpcPayload,
  });
  if (rpcResult.error) {
    sendJson(res, 500, { error: { code: "SYNC_FAILED", message: "Failed to save phrase updates." } });
    return;
  }

  const firstRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
  const appliedUpdates = Number.isFinite(firstRow?.applied_updates) ? Number(firstRow.applied_updates) : 0;
  const updatedSessions = Number.isFinite(firstRow?.touched_sessions) ? Number(firstRow.touched_sessions) : 0;
  sendJson(res, 200, { ok: true, updatedSessions, acceptedUpdates: updates.length, appliedUpdates });
}
