import { sendJson, readJsonBody } from "../server/core/http.js";
import { authenticateClerkRequest } from "../server/core/auth.js";
import {
  fetchPhraseScores,
  resolveAppUserIdByClerkUserId,
} from "../server/services/phraseProficiency.js";

function normalizeRequestedPhrases(value) {
  if (!Array.isArray(value)) return [];
  const deduped = [];
  const seen = new Set();
  for (const raw of value) {
    const phrase = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(phrase);
    if (deduped.length >= 200) break;
  }
  return deduped;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST /api/phrase-proficiency." } });
    return;
  }

  const auth = await authenticateClerkRequest(req, { requireAuth: false });
  if (!auth.ok) {
    sendJson(res, 401, { error: { code: auth.code ?? "UNAUTHORIZED", message: auth.message ?? "Sign in required." } });
    return;
  }

  if (!auth.clerkUserId) {
    sendJson(res, 200, { scores: {} });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    return;
  }

  const phrases = normalizeRequestedPhrases(body?.phrases);
  if (!phrases.length) {
    sendJson(res, 200, { scores: {} });
    return;
  }

  try {
    const appUserId = await resolveAppUserIdByClerkUserId(auth.clerkUserId);
    if (!appUserId) {
      sendJson(res, 200, { scores: {} });
      return;
    }
    const scores = await fetchPhraseScores(appUserId, phrases);
    sendJson(res, 200, { scores });
  } catch {
    sendJson(res, 500, { error: { code: "PROFICIENCY_FETCH_FAILED", message: "Failed to load phrase proficiency." } });
  }
}

