import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_CARD_CONTENT_MAX_CHARS,
  DEFAULT_CARD_TITLE_MAX_CHARS,
  truncateCardCharacters,
} from "@lf/core/text/cardText";
import { getSession } from "../auth/authStorage";
import { environmentStorageKey } from "../storage/environmentStorageKey";

export type CardDraftImage = {
  localUri: string;
  uploadId: string | null;
  status: "pending" | "uploading" | "moderating" | "ready" | "failed";
  width: number;
  height: number;
  focusX?: number;
  focusY?: number;
  fileSize: number;
  mimeType: "image/jpeg" | "image/png";
};

export type CardDraft = {
  mode: "rewrite" | "corpus";
  collectionId: string | null;
  title: string;
  text: string;
  rewrittenText: string;
  translationText: string;
  replyText: string;
  /** The original text that the generated layers belong to. */
  derivedFromText: string;
  clientId: string | null;
  recordId: string | null;
  submitted: boolean;
  clozeRanges: Array<{ startUtf16: number; endUtf16: number }>;
  enabledLayers: { expression: boolean; translation: boolean; reply: boolean };
  generateImageDescription: boolean;
  images: CardDraftImage[];
};

const EMPTY_DRAFT: CardDraft = { mode: "rewrite", collectionId: null, title: "", text: "", rewrittenText: "", translationText: "", replyText: "", derivedFromText: "", clientId: null, recordId: null, submitted: false, clozeRanges: [], enabledLayers: { expression: true, translation: false, reply: false }, generateImageDescription: false, images: [] };
let draftStorageQueue: Promise<void> = Promise.resolve();

async function key(mode: CardDraft["mode"]): Promise<string | null> {
  const session = await getSession();
  return session?.user.id
    ? environmentStorageKey(`lf_card_draft_v1:${session.user.id}:${mode}`)
    : null;
}

async function legacyKey(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id ? environmentStorageKey(`lf_card_draft_v1:${session.user.id}`) : null;
}

export async function loadCardDraft(mode: CardDraft["mode"] = "rewrite"): Promise<CardDraft> {
  const storageKey = await key(mode);
  if (!storageKey) return emptyDraft(mode);
  const raw = await AsyncStorage.getItem(storageKey)
    ?? (mode === "rewrite" ? await legacyKey().then((value) => value ? AsyncStorage.getItem(value) : null) : null);
  if (!raw) return emptyDraft(mode);
  try {
    const value = JSON.parse(raw) as Partial<CardDraft>;
    const text = truncateDraftText(value.text, DEFAULT_CARD_CONTENT_MAX_CHARS);
    const rewrittenText = truncateDraftText(value.rewrittenText, DEFAULT_CARD_CONTENT_MAX_CHARS);
    const translationText = truncateDraftText(value.translationText, DEFAULT_CARD_CONTENT_MAX_CHARS);
    const replyText = truncateDraftText(value.replyText, DEFAULT_CARD_CONTENT_MAX_CHARS);
    const storedDerivedFromText = typeof value.derivedFromText === "string"
      ? truncateDraftText(value.derivedFromText, DEFAULT_CARD_CONTENT_MAX_CHARS)
      : null;
    const derivedContentIsTrusted = storedDerivedFromText === text;
    return {
      mode,
      collectionId: typeof value.collectionId === "string" ? value.collectionId : null,
      title: truncateDraftText(value.title, DEFAULT_CARD_TITLE_MAX_CHARS),
      text,
      // Never restore generated text unless its source is known to be this exact
      // original. Legacy drafts regenerate selected layers on their next save.
      rewrittenText: mode === "corpus" ? "" : derivedContentIsTrusted ? rewrittenText : "",
      translationText: mode === "corpus" ? "" : derivedContentIsTrusted ? translationText : "",
      replyText: mode === "corpus" ? "" : derivedContentIsTrusted ? replyText : "",
      derivedFromText: mode === "corpus" ? "" : derivedContentIsTrusted ? text : "",
      clientId: typeof value.clientId === "string" ? value.clientId : null,
      recordId: typeof value.recordId === "string" ? value.recordId : null,
      submitted: value.submitted === true,
      clozeRanges: mode === "corpus" ? [] : derivedContentIsTrusted ? normalizeClozeRanges(value.clozeRanges, rewrittenText.length) : [],
      enabledLayers: {
        expression: mode !== "corpus",
        translation: mode !== "corpus" && (value.enabledLayers?.translation === true || Boolean(translationText)),
        reply: mode !== "corpus" && Boolean(replyText),
      },
      generateImageDescription: mode !== "corpus" && value.generateImageDescription === true,
      images: mode === "corpus" ? [] : Array.isArray(value.images)
        ? value.images.map(normalizeImage).filter((image): image is CardDraftImage => Boolean(image))
        : (() => { const legacy = normalizeImage((value as Partial<CardDraft> & { image?: unknown }).image); return legacy ? [legacy] : []; })(),
    };
  } catch {
    return emptyDraft(mode);
  }
}

function emptyDraft(mode: CardDraft["mode"]): CardDraft {
  return mode === "rewrite"
    ? { ...EMPTY_DRAFT, enabledLayers: { ...EMPTY_DRAFT.enabledLayers }, images: [] }
    : { ...EMPTY_DRAFT, mode: "corpus", enabledLayers: { expression: false, translation: false, reply: false }, images: [] };
}

function normalizeClozeRanges(value: unknown, textLength: number): CardDraft["clozeRanges"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const startUtf16 = Math.max(0, Math.min(Number(row.startUtf16) || 0, textLength));
      const endUtf16 = Math.max(startUtf16, Math.min(Number(row.endUtf16) || 0, textLength));
      return startUtf16 < endUtf16 ? { startUtf16, endUtf16 } : null;
    })
    .filter((item): item is { startUtf16: number; endUtf16: number } => Boolean(item))
    .sort((left, right) => left.startUtf16 - right.startUtf16 || left.endUtf16 - right.endUtf16)
    .reduce<CardDraft["clozeRanges"]>((kept, range) => {
      const previous = kept[kept.length - 1];
      if (!previous || range.startUtf16 >= previous.endUtf16) kept.push(range);
      return kept;
    }, []);
}

function normalizeImage(value: unknown): CardDraftImage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.localUri !== "string" || !row.localUri) return null;
  const status = row.status;
  return {
    localUri: row.localUri,
    uploadId: typeof row.uploadId === "string" ? row.uploadId : null,
    status: status === "uploading" || status === "moderating" || status === "ready" || status === "failed" ? status : "pending",
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    focusX: clampUnit(row.focusX),
    focusY: clampUnit(row.focusY),
    fileSize: Number(row.fileSize) || 0,
    mimeType: row.mimeType === "image/png" ? "image/png" : "image/jpeg",
  };
}

function clampUnit(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

export async function saveCardDraft(draft: CardDraft): Promise<void> {
  const storageKeyPromise = key(draft.mode);
  const safeDraft = draft.mode === "corpus" ? {
    ...draft,
    rewrittenText: "",
    translationText: "",
    replyText: "",
    derivedFromText: "",
    clozeRanges: [],
    enabledLayers: { expression: false, translation: false, reply: false },
    generateImageDescription: false,
    images: [],
  } : draft;
  const serialized = JSON.stringify({
    ...safeDraft,
    title: truncateDraftText(safeDraft.title, DEFAULT_CARD_TITLE_MAX_CHARS),
    text: truncateDraftText(safeDraft.text, DEFAULT_CARD_CONTENT_MAX_CHARS),
    rewrittenText: truncateDraftText(safeDraft.rewrittenText, DEFAULT_CARD_CONTENT_MAX_CHARS),
    translationText: truncateDraftText(safeDraft.translationText, DEFAULT_CARD_CONTENT_MAX_CHARS),
    replyText: truncateDraftText(safeDraft.replyText, DEFAULT_CARD_CONTENT_MAX_CHARS),
    derivedFromText: truncateDraftText(safeDraft.derivedFromText, DEFAULT_CARD_CONTENT_MAX_CHARS),
  });
  draftStorageQueue = draftStorageQueue.catch(() => undefined).then(async () => {
    const storageKey = await storageKeyPromise;
    if (storageKey) await AsyncStorage.setItem(storageKey, serialized);
  });
  await draftStorageQueue;
}

export async function clearCardDraft(mode: CardDraft["mode"] = "rewrite"): Promise<void> {
  const storageKeyPromise = key(mode);
  draftStorageQueue = draftStorageQueue.catch(() => undefined).then(async () => {
    const storageKey = await storageKeyPromise;
    if (storageKey) await AsyncStorage.removeItem(storageKey);
  });
  await draftStorageQueue;
}

function truncateDraftText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? truncateCardCharacters(value, maxLength) : "";
}
