import { getViewerAccessByClerkUserId } from "./access.js";
import { getSupabaseAdmin } from "../infrastructure/supabase.js";

const MAX_BATCH_PHRASES = 200;
const RECENT_CANDIDATE_FETCH_LIMIT = 200;
const RECENT_CANDIDATE_LIMIT = 20;
const RECENT_PROFICIENCY_PHRASE_LIMIT = 20;
const MAX_MATCHED_CHAT_PHRASES = 3;

function normalizePhraseKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function toDisplayPhrase(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value) {
  return normalizePhraseKey(value)
    .split(/\s+/)
    .filter(Boolean);
}

export async function resolveAppUserIdByClerkUserId(clerkUserId) {
  if (!clerkUserId) return "";
  const viewer = await getViewerAccessByClerkUserId(clerkUserId);
  return viewer.profile?.appUserId ?? "";
}

export async function fetchPhraseScores(appUserId, phrases) {
  if (!appUserId) return {};
  const normalized = Array.isArray(phrases)
    ? Array.from(
      new Set(
        phrases
          .map(normalizePhraseKey)
          .filter(Boolean),
      ),
    ).slice(0, MAX_BATCH_PHRASES)
    : [];
  if (!normalized.length) return {};

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_phrase_proficiency")
    .select("phrase_norm,score")
    .eq("user_id", appUserId)
    .in("phrase_norm", normalized);
  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    const key = normalizePhraseKey(row.phrase_norm);
    if (!key) continue;
    map[key] = Number.isFinite(Number(row.score)) ? Number(row.score) : 0;
  }
  return map;
}

export async function listRecentCandidatePhrases(appUserId) {
  if (!appUserId) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("chat_turns")
    .select("key_phrases")
    .eq("user_id", appUserId)
    .eq("role", "assistant")
    .order("occurred_at", { ascending: false })
    .limit(RECENT_CANDIDATE_FETCH_LIMIT);
  if (error) throw error;

  const deduped = [];
  const seen = new Set();
  for (const row of data ?? []) {
    const phrases = Array.isArray(row.key_phrases) ? row.key_phrases : [];
    for (const raw of phrases) {
      const display = toDisplayPhrase(raw);
      const norm = normalizePhraseKey(display);
      if (!display || !norm || seen.has(norm)) continue;
      seen.add(norm);
      deduped.push(display);
      if (deduped.length >= RECENT_CANDIDATE_LIMIT) {
        return deduped;
      }
    }
  }
  return deduped;
}

export function calcPhraseDeltaByMode(mode, quality) {
  if (quality !== "good" && quality !== "ok") return 0;
  if (mode === "practice_feedback") {
    return quality === "good" ? 2 : 1;
  }
  return quality === "good" ? 3 : 2;
}

export async function applyPhraseScoreDelta({
  appUserId,
  phrase,
  delta,
}) {
  if (!appUserId) return null;
  const safeDelta = Math.max(0, Math.floor(Number(delta) || 0));
  if (!safeDelta) return null;

  const phraseDisplay = toDisplayPhrase(phrase);
  const phraseNorm = normalizePhraseKey(phraseDisplay);
  if (!phraseNorm) return null;

  const supabase = getSupabaseAdmin();
  const { data: current, error: readError } = await supabase
    .from("user_phrase_proficiency")
    .select("score")
    .eq("user_id", appUserId)
    .eq("phrase_norm", phraseNorm)
    .maybeSingle();
  if (readError) throw readError;

  const currentScore = Number.isFinite(Number(current?.score)) ? Number(current.score) : 0;
  const nextScore = currentScore + safeDelta;
  const now = new Date().toISOString();

  const { error: writeError } = await supabase
    .from("user_phrase_proficiency")
    .upsert(
      {
        user_id: appUserId,
        phrase_norm: phraseNorm,
        phrase_display: phraseDisplay,
        score: nextScore,
        updated_at: now,
      },
      { onConflict: "user_id,phrase_norm" },
    );
  if (writeError) throw writeError;

  return {
    phrase: phraseDisplay,
    phrase_norm: phraseNorm,
    delta: safeDelta,
    score: nextScore,
  };
}

export async function listRecentUserProficiencyPhrases(appUserId, limit = RECENT_PROFICIENCY_PHRASE_LIMIT) {
  if (!appUserId) return [];
  const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || RECENT_PROFICIENCY_PHRASE_LIMIT)));
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_phrase_proficiency")
    .select("phrase_norm,phrase_display")
    .eq("user_id", appUserId)
    .order("updated_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;

  const deduped = [];
  const seen = new Set();
  for (const row of data ?? []) {
    const phrase = toDisplayPhrase(row?.phrase_display || row?.phrase_norm);
    const norm = normalizePhraseKey(phrase);
    if (!phrase || !norm || seen.has(norm)) continue;
    seen.add(norm);
    deduped.push({ phrase, norm, tokens: tokenize(norm) });
  }
  return deduped;
}

export function matchRecentPhrasesFromText(text, recentPhrases, maxMatches = MAX_MATCHED_CHAT_PHRASES) {
  const normalizedText = normalizePhraseKey(text);
  if (!normalizedText) return [];
  const textTokens = new Set(tokenize(normalizedText));
  const safeMax = Math.max(1, Math.min(10, Math.floor(Number(maxMatches) || MAX_MATCHED_CHAT_PHRASES)));
  const matches = [];
  for (const candidate of Array.isArray(recentPhrases) ? recentPhrases : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const phrase = toDisplayPhrase(candidate.phrase);
    const norm = normalizePhraseKey(candidate.norm || phrase);
    const tokens = Array.isArray(candidate.tokens) ? candidate.tokens : tokenize(norm);
    if (!phrase || !norm || !tokens.length) continue;

    const exactContains = normalizedText.includes(norm);
    const tokenCovered = tokens.every((token) => textTokens.has(token));
    if (!exactContains && !tokenCovered) continue;
    matches.push(phrase);
    if (matches.length >= safeMax) break;
  }
  return matches;
}
