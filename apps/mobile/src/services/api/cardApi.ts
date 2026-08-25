import { getAuthHeaders } from "../auth/authHeaders";
import { fetchWithTimeout } from "./fetchWithTimeout";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export type CardStatus = "queued" | "processing" | "completed" | "failed";
export type CardLearningContentType = "original" | "rewrite" | "reply";
export type CardCapabilities = {
  limits: {
    titleChars: number;
    contentChars: number;
    imagesPerCard: number;
    listPageSize: number;
  };
};

export const DEFAULT_CARD_CAPABILITIES: CardCapabilities = {
  limits: {
    titleChars: 100,
    contentChars: 5_000,
    imagesPerCard: 10,
    listPageSize: 50,
  },
};

let cardCapabilitiesCache: CardCapabilities | null = null;
let cardCapabilitiesPromise: Promise<CardCapabilities> | null = null;

export type CardRecordSummary = {
  id: string;
  title: string | null;
  displayTitle: string;
  topic?: string | null;
  collectionId?: string | null;
  source: "card";
  dateKey: string;
  originalPreview: string;
  rewrittenPreview: string | null;
  languageCode: string;
  status: Exclude<CardStatus, "failed">;
  thumbnail: { url: string; urlExpiresAt?: string | null; width: number; height: number } | null;
  practiceSummary: unknown | null;
  isSample: boolean;
  createdAt: string;
};

export type CardRecordDetail = CardRecordSummary & {
  status: "completed";
  originalText: string;
  rewrittenText: string | null;
  rewrittenLanguageCode: string | null;
  translationText: string | null;
  translationLanguageCode: string | null;
  replyText: string | null;
  replyLanguageCode: string | null;
  rewriteSegments: Array<{
    id: string;
    ordinal: number;
    text: string;
    startUtf16: number;
    endUtf16: number;
  }>;
  contentBlocks: Array<{
    contentType: CardLearningContentType;
    contentVersion: string;
    text: string;
    languageCode: string;
    segments: CardRecordDetail["rewriteSegments"];
    practice: CardRecordDetail["practice"];
  }>;
  images?: Array<{
    id: string;
    url: string;
    urlExpiresAt?: string | null;
    width: number;
    height: number;
    thumbnail?: { id: string; url: string; urlExpiresAt?: string | null; width: number; height: number } | null;
  }>;
  image: {
    id: string;
    url: string;
    urlExpiresAt?: string | null;
    width: number;
    height: number;
    thumbnail?: { id: string; url: string; urlExpiresAt?: string | null; width: number; height: number } | null;
  } | null;
  practice: {
    hasCloze: boolean;
    dictationCompleted: boolean;
    nextReviewAt: string | null;
    clozeState: unknown | null;
    clozeVersion: number;
    clozeLastResult: "correct" | "incorrect" | "revealed" | null;
    dictationLastResult: "correct" | "incorrect" | "revealed" | null;
  } | null;
};

export type CardPracticeQueueItem = {
  record: CardRecordSummary;
  initialTab: "cloze" | "dictation";
  reason: "continue_cloze" | "retry" | "try_dictation" | "review";
};

export type CardMemoryRoundCandidate = {
  recordId: string;
  title: string | null;
  displayTitle: string;
  languageCode: string;
  thumbnail: { url: string; urlExpiresAt?: string | null; width: number; height: number } | null;
  createdAt: string;
  contentType: CardLearningContentType | null;
  contentVersion: string | null;
  segments: CardRecordDetail["rewriteSegments"];
  clozeState: CardClozeState;
  clozeVersion: number;
  clozeLastResult: "correct" | "incorrect" | "revealed" | null;
  clozeNextReviewAt: string | null;
};

export type CardCollection = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  isFavorite: boolean;
  favoriteSortOrder: number | null;
  name: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CardClozeBlank = {
  id: string;
  segmentId: string;
  startUtf16: number;
  endUtf16: number;
  answer: string;
  mastered?: boolean;
};

export type CardClozeState = { schemaVersion: 1; blanks: CardClozeBlank[] };

export class CardApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export async function createCardEntry(input: {
  clientId: string;
  collectionId: string | null;
  title?: string | null;
  originalText?: string | null;
  rewrittenText?: string | null;
  translationText?: string | null;
  replyText?: string | null;
  generateRewrite?: boolean;
  imageUploadIds?: string[];
  imageUploadId?: string | null;
}): Promise<CardRecordSummary> {
  return request<CardRecordSummary>("/cards", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCardContent(
  recordId: string,
  input: Partial<Record<"title" | "originalText" | "rewrittenText" | "translationText" | "replyText" | "collectionId", string | null>>,
): Promise<CardRecordDetail> {
  return request<CardRecordDetail>(`/cards/${encodeURIComponent(requireCardId(recordId))}/content`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function generateCardContent(
  recordId: string,
  target: "expression" | "translation" | "reply",
): Promise<CardRecordDetail> {
  return request<CardRecordDetail>(`/cards/${encodeURIComponent(requireCardId(recordId))}/generate`, {
    method: "POST",
    headers: { "x-lf-usage-api": "v2" },
    body: JSON.stringify({ target }),
  });
}

export async function generateCardDraftContent(
  target: "expression" | "translation" | "reply",
  sourceText: string,
): Promise<{ text: string }> {
  return request<{ text: string }>("/cards/generate-preview", {
    method: "POST",
    headers: { "x-lf-usage-api": "v2" },
    body: JSON.stringify({ target, sourceText }),
  });
}

export type CardImageUploadStatus = "uploading" | "moderating" | "approved" | "approved_with_review" | "rejected" | "moderation_failed" | "cleanup_pending";

export async function createCardImageUpload(input: {
  mimeType: string; fileSize: number; width: number; height: number;
}): Promise<{ uploadId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: string }> {
  return request("/cards/image-uploads", { method: "POST", headers: { "x-lf-usage-api": "v2" }, body: JSON.stringify(input) });
}

export async function completeCardImageUpload(uploadId: string): Promise<{ uploadId: string; status: CardImageUploadStatus; expiresAt: string }> {
  return request(`/cards/image-uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST", headers: { "x-lf-usage-api": "v2" }, body: "{}" });
}

export async function getCardImageUpload(uploadId: string): Promise<{ uploadId: string; status: CardImageUploadStatus; expiresAt: string }> {
  return request(`/cards/image-uploads/${encodeURIComponent(uploadId)}`);
}

export async function deleteCardImageUpload(uploadId: string): Promise<void> {
  await request<void>(`/cards/image-uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
}

export async function bootstrapCard(): Promise<CardRecordSummary[]> {
  return request<CardRecordSummary[]>("/cards/bootstrap", {
    method: "POST",
    body: "{}",
  });
}

export async function getCardCapabilities(): Promise<CardCapabilities> {
  if (cardCapabilitiesCache) return cardCapabilitiesCache;
  if (!cardCapabilitiesPromise) {
    cardCapabilitiesPromise = request<CardCapabilities>("/cards/capabilities")
      .then((value) => {
        cardCapabilitiesCache = value;
        return value;
      })
      .finally(() => {
        cardCapabilitiesPromise = null;
      });
  }
  return cardCapabilitiesPromise;
}

export async function getCardRecords(input?: {
  dateKey?: string;
  collectionId?: string;
  unclassified?: boolean;
  limit?: number;
  offset?: number;
  fromDateKey?: string;
}): Promise<CardRecordSummary[]> {
  const params = new URLSearchParams();
  if (input?.dateKey) params.set("dateKey", input.dateKey);
  if (input?.collectionId) params.set("collectionId", input.collectionId);
  if (input?.unclassified) params.set("unclassified", "true");
  if (input?.offset) params.set("offset", String(input.offset));
  if (input?.fromDateKey) params.set("fromDateKey", input.fromDateKey);
  params.set("limit", String(input?.limit ?? 100));
  return request(`/cards?${params.toString()}`);
}

export type CardRecordPage = { items: CardRecordSummary[]; nextCursor: string | null };

export async function getCardRecordPage(input?: {
  dateKey?: string;
  collectionId?: string;
  unclassified?: boolean;
  limit?: number;
  cursor?: string;
  fromDateKey?: string;
  sort?: "newest" | "oldest";
}): Promise<CardRecordPage> {
  const params = new URLSearchParams();
  if (input?.dateKey) params.set("dateKey", input.dateKey);
  if (input?.collectionId) params.set("collectionId", input.collectionId);
  if (input?.unclassified) params.set("unclassified", "true");
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.fromDateKey) params.set("fromDateKey", input.fromDateKey);
  if (input?.sort) params.set("sort", input.sort);
  params.set("limit", String(input?.limit ?? 50));
  return request(`/cards/page?${params.toString()}`);
}

export async function getCardCollections(): Promise<{
  unclassifiedCount: number;
  collections: CardCollection[];
}> {
  return request("/cards/collections");
}

export async function createCardCollection(name: string, parentId: string | null = null): Promise<CardCollection> {
  return request("/cards/collections", { method: "POST", body: JSON.stringify({ name, parentId }) });
}

export async function renameCardCollection(collectionId: string, name: string): Promise<CardCollection> {
  return request(`/cards/collections/${encodeURIComponent(collectionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteCardCollection(collectionId: string): Promise<void> {
  await request<void>(`/cards/collections/${encodeURIComponent(collectionId)}`, { method: "DELETE" });
}

export async function moveCardCollection(collectionId: string, parentId: string | null, position?: number): Promise<void> {
  await request<void>(`/cards/collections/${encodeURIComponent(collectionId)}/parent`, {
    method: "PUT",
    body: JSON.stringify({ parentId, position }),
  });
}

export async function setCardCollectionFavorite(collectionId: string, isFavorite: boolean): Promise<void> {
  await request<void>(`/cards/collections/${encodeURIComponent(collectionId)}/favorite`, {
    method: "PUT",
    body: JSON.stringify({ isFavorite }),
  });
}

export async function reorderFavoriteCardCollection(collectionId: string, position: number): Promise<void> {
  await request<void>(`/cards/collections/${encodeURIComponent(collectionId)}/favorite-position`, {
    method: "PUT",
    body: JSON.stringify({ position }),
  });
}

export async function moveCardToCollection(recordId: string, collectionId: string | null): Promise<void> {
  await request<void>(`/cards/${encodeURIComponent(recordId)}/collection`, {
    method: "PUT",
    body: JSON.stringify({ collectionId }),
  });
}

export async function moveCardsToCollection(recordIds: string[], collectionId: string | null): Promise<void> {
  await request<void>("/cards/collection", {
    method: "PUT",
    body: JSON.stringify({ recordIds, collectionId }),
  });
}

export async function updateCardTitle(recordId: string, title: string | null): Promise<{ title: string | null }> {
  return request(`/cards/${encodeURIComponent(recordId)}/title`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function getCardDateKeys(fromDateKey: string, toDateKey: string): Promise<string[]> {
  return request(`/cards/date-keys?fromDateKey=${encodeURIComponent(fromDateKey)}&toDateKey=${encodeURIComponent(toDateKey)}`);
}

export type CardCalendarSummary = {
  fromDateKey: string;
  toDateKey: string;
  firstRecordDateKey: string | null;
  totals: { cardCount: number; originalChars: number; recordedDays: number };
  days: Array<{ dateKey: string; cardCount: number; originalChars: number; clozeBlankCount: number; clozeAttemptedBlankCount: number; clozeCorrectBlankCount: number }>;
};

export async function getCardCalendarSummary(fromDateKey: string, toDateKey: string): Promise<CardCalendarSummary> {
  return request(`/cards/calendar-summary?fromDateKey=${encodeURIComponent(fromDateKey)}&toDateKey=${encodeURIComponent(toDateKey)}`);
}

export async function getRecentCardFragments(beforeDateKey: string): Promise<CardRecordSummary[]> {
  return request(`/cards/recent-fragments?beforeDateKey=${encodeURIComponent(beforeDateKey)}&limit=2`);
}

export async function getCardTaskStatus(recordId: string): Promise<{
  recordId: string;
  status: CardStatus;
  message: string | null;
}> {
  return request(`/cards/${encodeURIComponent(recordId)}/status`);
}

export async function getCardRecord(recordId: string): Promise<CardRecordDetail> {
  return request(`/cards/${encodeURIComponent(recordId)}`);
}

export async function getRelatedTopicCards(recordId: string, limit = 10): Promise<Array<{
  recordId: string;
  topic: string;
  reason: { type: "topic"; score: number; modelVersion: string };
}>> {
  return request(`/cards/${encodeURIComponent(recordId)}/related-topics?limit=${encodeURIComponent(String(limit))}`);
}

export async function getRelatedPhraseCards(recordId: string, limit = 30): Promise<Array<{
  recordId: string;
  topic: string | null;
  reason: {
    type: "phrase";
    phraseId: string;
    phrase: string;
    evidence: "clozed" | "appeared";
    surfaceText: string;
    sentence: string;
  };
}>> {
  return request(`/cards/${encodeURIComponent(recordId)}/related-phrases?limit=${encodeURIComponent(String(limit))}`);
}

export async function getCardProgressRelations(recordId: string, limit = 30): Promise<Array<{
  recordId: string;
  topic: string | null;
  reason: {
    type: "progress";
    phraseId: string;
    phrase: string;
    previousExpression: string;
    currentExpression: string;
    isFirstUserProduced: boolean;
  };
}>> {
  return request(`/cards/${encodeURIComponent(recordId)}/progress?limit=${encodeURIComponent(String(limit))}`);
}

export type CardRelationReason =
  | { type: "topic"; score: number; modelVersion: string }
  | {
      type: "phrase";
      phraseId: string;
      phrase: string;
      evidence: "clozed" | "appeared";
      surfaceText: string;
      sentence: string;
    }
  | {
      type: "progress";
      phraseId: string;
      phrase: string;
      previousExpression: string;
      currentExpression: string;
      isFirstUserProduced: boolean;
    };

export type CardRelationPreview = {
  id: string;
  source: "card";
  topic: string | null;
  collectionId: string | null;
  dateKey: string;
  originalText: string;
  rewrittenText: string;
  languageCode: string;
  isSample: boolean;
  createdAt: string;
  thumbnail: { url: string; urlExpiresAt: string | null; width: number; height: number } | null;
};

export async function getCardRelations(recordId: string, limit = 20): Promise<Array<{
  recordId: string;
  topic: string | null;
  card: CardRelationPreview | null;
  reasons: CardRelationReason[];
}>> {
  return request(`/cards/${encodeURIComponent(recordId)}/relations?limit=${encodeURIComponent(String(limit))}`);
}

export type RecallCandidate = {
  recordId: string;
  title: string | null;
  displayTitle: string;
  topic: string | null;
  originalText: string;
  rewrittenText: string;
  createdAt: string;
  thumbnail: { url: string; urlExpiresAt?: string | null; width: number; height: number } | null;
  reason: "long_unseen" | "has_connections" | "shuffle" | "search" | "semantic_search";
  semanticScore?: number;
  matches?: Array<{
    field: "title" | "topic" | "original" | "ai_expression" | "organization" | "reply";
    matchType: "exact" | "variant";
    sentence: string;
    surfaceText: string;
    startUtf16: number | null;
    endUtf16: number | null;
    phraseId?: string;
  }>;
};

export type RecallSession = {
  id: string;
  seedRecordId: string;
  launchMode: string;
  launchContext: Record<string, string> | null;
  status: "active" | "completed" | "abandoned";
  lastOpenedAt: string;
  createdAt: string;
  completedAt: string | null;
  nodes: Array<{
    id: string;
    recordId: string;
    state: "unvisited" | "current" | "completed";
    ordinal: number;
    openedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    relationType: "topic" | "phrase" | "progress" | "timeline";
    phraseId: string | null;
    reasons: CardRelationReason[];
    isDirected: boolean;
    createdAt: string;
  }>;
};

export async function getRecallSeedCandidates(mode: "recommended" | "shuffle" = "recommended", exclude: string[] = []): Promise<RecallCandidate[]> {
  return request(`/cards/recall/seed-candidates?mode=${mode}&limit=6&exclude=${encodeURIComponent(exclude.join(","))}`);
}

export async function searchCardsLexically(input: {
  q: string;
  collectionId?: string;
  timeRange?: string;
  limit?: number;
}): Promise<RecallCandidate[]> {
  const params = new URLSearchParams({
    q: input.q,
    limit: String(input.limit ?? 20),
  });
  if (input.collectionId) params.set("collectionId", input.collectionId);
  if (input.timeRange) params.set("timeRange", input.timeRange);
  return request(`/cards/search?${params.toString()}`);
}

export async function searchRecallCards(input: { q?: string; collectionId?: string; timeRange?: string }): Promise<RecallCandidate[]> {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.collectionId) params.set("collectionId", input.collectionId);
  if (input.timeRange) params.set("timeRange", input.timeRange);
  return request(`/cards/recall/search?${params.toString()}`);
}

export async function createRecallSession(seedRecordId: string, launchMode: string, launchContext?: Record<string, string>): Promise<RecallSession> {
  return request("/cards/recall/sessions", { method: "POST", body: JSON.stringify({ seedRecordId, launchMode, launchContext }) });
}

export async function createRecallSessionFromRecords(recordIds: string[], query?: string): Promise<RecallSession> {
  return request("/cards/recall/sessions/from-records", { method: "POST", body: JSON.stringify({ recordIds, query }) });
}

export async function getActiveRecallSession(): Promise<RecallSession | null> {
  return request("/cards/recall/sessions/active");
}

export async function expandRecallNode(sessionId: string, nodeId: string): Promise<RecallSession> {
  return request(`/cards/recall/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}/expand`, { method: "POST", body: "{}" });
}

export async function updateRecallNode(sessionId: string, nodeId: string, state: RecallSession["nodes"][number]["state"]): Promise<RecallSession> {
  return request(`/cards/recall/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "PATCH", body: JSON.stringify({ state }) });
}

export async function finishRecallSession(sessionId: string): Promise<void> {
  await request<void>(`/cards/recall/sessions/${encodeURIComponent(sessionId)}/finish`, { method: "POST", body: "{}" });
}

export async function deleteCardRecord(recordId: string): Promise<void> {
  await request<void>(`/cards/${encodeURIComponent(recordId)}`, { method: "DELETE" });
}

export async function getCardPracticeQueue(limit = 20): Promise<CardPracticeQueueItem[]> {
  return request(`/cards/practice/queue?limit=${encodeURIComponent(String(limit))}`);
}

export async function getCardMemoryRoundCandidates(limit = 40): Promise<CardMemoryRoundCandidate[]> {
  return request(`/cards/practice/memory-round?limit=${encodeURIComponent(String(limit))}`);
}

export async function validateCardMemoryRoundCandidates(candidates: Array<{ recordId: string; contentType: CardLearningContentType | null; contentVersion: string | null }>): Promise<CardMemoryRoundCandidate[]> {
  return request("/cards/practice/memory-round/validate", {
    method: "POST",
    body: JSON.stringify({ candidates }),
  });
}

export async function saveCardDictationResult(
  recordId: string,
  result: "correct" | "incorrect" | "revealed",
  binding?: { contentType: CardLearningContentType; contentVersion: string },
): Promise<CardRecordDetail["practice"]> {
  const cardId = requireCardId(recordId);
  return request(`/cards/${encodeURIComponent(cardId)}/practice/dictation`, {
    method: "PUT",
    body: JSON.stringify({ result, ...binding }),
  });
}

export async function saveCardClozeUpdate(
  recordId: string,
  input: {
    contentType?: CardLearningContentType;
    contentVersion?: string;
    baseVersion: number;
    operation:
      | { type: "add"; segmentId: string; startUtf16: number; endUtf16: number }
      | { type: "remove"; blankId: string }
      | { type: "master"; blankId: string }
      | { type: "memory_result"; blankIds: string[] }
      | { type: "result" };
    result?: "correct" | "incorrect" | "revealed";
  },
): Promise<NonNullable<CardRecordDetail["practice"]>> {
  const cardId = requireCardId(recordId);
  return request(`/cards/${encodeURIComponent(cardId)}/practice/cloze`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function replaceCardRecordImage(recordId: string, imageUploadId: string): Promise<CardRecordDetail> {
  return request(`/cards/${encodeURIComponent(recordId)}/image`, {
    method: "POST",
    body: JSON.stringify({ imageUploadId }),
  });
}

export async function removeCardRecordImage(recordId: string): Promise<CardRecordDetail> {
  return request(`/cards/${encodeURIComponent(recordId)}/image`, { method: "DELETE" });
}

export async function appendCardRecordImage(recordId: string, imageUploadId: string): Promise<CardRecordDetail> {
  return request(`/cards/${encodeURIComponent(requireCardId(recordId))}/images`, {
    method: "POST",
    body: JSON.stringify({ imageUploadId }),
  });
}

export async function removeCardRecordImageById(recordId: string, imageId: string): Promise<CardRecordDetail> {
  return request(`/cards/${encodeURIComponent(requireCardId(recordId))}/images/${encodeURIComponent(imageId)}`, {
    method: "DELETE",
  });
}

export async function getCardSelectionAudio(input: {
  entryId: string;
  segmentId: string;
  startUtf16: number;
  endUtf16: number;
  contentType?: CardLearningContentType;
  contentVersion?: string;
}): Promise<{ audioUrl: string; audioUrlExpiresAt: string | null; provider: string; voiceCode: string }> {
  return request(`/tts/cards/${encodeURIComponent(input.entryId)}/selection`, {
    method: "POST",
    body: JSON.stringify({
      segmentId: input.segmentId,
      start: input.startUtf16,
      end: input.endUtf16,
      contentType: input.contentType,
      contentVersion: input.contentVersion,
    }),
  });
}

export async function getCardSegmentAudio(input: {
  entryId: string;
  segmentId: string;
  sourceKind: "review_segment" | "dictation_sentence";
  startUtf16?: number;
  endUtf16?: number;
  contentType?: CardLearningContentType;
  contentVersion?: string;
}): Promise<{ audioUrl: string; audioUrlExpiresAt: string | null; provider: string; voiceCode: string }> {
  const range = input.startUtf16 === undefined || input.endUtf16 === undefined
    ? ""
    : `&start=${encodeURIComponent(String(input.startUtf16))}&end=${encodeURIComponent(String(input.endUtf16))}`;
  const binding = input.contentType && input.contentVersion
    ? `&contentType=${encodeURIComponent(input.contentType)}&contentVersion=${encodeURIComponent(input.contentVersion)}`
    : "";
  return request(`/tts/cards/${encodeURIComponent(input.entryId)}/segments/${encodeURIComponent(input.segmentId)}?sourceKind=${input.sourceKind}${range}${binding}`);
}

export async function getCardArticleAudio(input: {
  entryId: string;
  contentType: CardLearningContentType;
  contentVersion: string;
}): Promise<{
  audioUrl: string;
  audioUrlExpiresAt: string | null;
  provider: string;
  voiceCode: string;
  durationMs: number | null;
  sentenceMarks: Array<{ text: string; textStart: number; textEnd: number; startMs: number; durationMs: number }> | null;
  deliveryMode?: "buffered" | "streaming";
  generationId?: string;
}> {
  const binding = `contentType=${encodeURIComponent(input.contentType)}&contentVersion=${encodeURIComponent(input.contentVersion)}&streaming=1`;
  const audio = await request<Awaited<ReturnType<typeof getCardArticleAudio>>>(`/tts/cards/${encodeURIComponent(input.entryId)}/segments/__article__?${binding}`);
  return {
    ...audio,
    audioUrl: audio.audioUrl.startsWith("/") ? `${BASE_URL}${audio.audioUrl}` : audio.audioUrl,
  };
}

function requireCardId(recordId: string): string {
  if (!recordId.startsWith("card:") || recordId.length <= "card:".length) {
    throw new CardApiError("CARD_VALIDATION_FAILED", "Invalid card id", 400);
  }
  return recordId.slice("card:".length);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(await getAuthHeaders()),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as ApiResult<T>;
  if (!result.ok) throw new CardApiError(result.error.code, result.error.message, response.status);
  return result.data;
}
