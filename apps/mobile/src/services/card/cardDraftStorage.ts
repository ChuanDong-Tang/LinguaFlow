import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSession } from "../auth/authStorage";
import { environmentStorageKey } from "../storage/environmentStorageKey";

export type CardDraft = {
  text: string;
  clientId: string | null;
  recordId: string | null;
  submitted: boolean;
  image: {
    localUri: string;
    uploadId: string | null;
    status: "pending" | "uploading" | "moderating" | "ready" | "failed";
    width: number;
    height: number;
    fileSize: number;
    mimeType: "image/jpeg" | "image/png";
  } | null;
};

const EMPTY_DRAFT: CardDraft = { text: "", clientId: null, recordId: null, submitted: false, image: null };

async function key(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id
    ? environmentStorageKey(`lf_card_draft_v1:${session.user.id}`)
    : null;
}

export async function loadCardDraft(): Promise<CardDraft> {
  const storageKey = await key();
  if (!storageKey) return EMPTY_DRAFT;
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return EMPTY_DRAFT;
  try {
    const value = JSON.parse(raw) as Partial<CardDraft>;
    return {
      text: typeof value.text === "string" ? value.text.slice(0, 10_000) : "",
      clientId: typeof value.clientId === "string" ? value.clientId : null,
      recordId: typeof value.recordId === "string" ? value.recordId : null,
      submitted: value.submitted === true,
      image: normalizeImage(value.image),
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function normalizeImage(value: unknown): CardDraft["image"] {
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
    fileSize: Number(row.fileSize) || 0,
    mimeType: row.mimeType === "image/png" ? "image/png" : "image/jpeg",
  };
}

export async function saveCardDraft(draft: CardDraft): Promise<void> {
  const storageKey = await key();
  if (!storageKey) return;
  await AsyncStorage.setItem(storageKey, JSON.stringify({ ...draft, text: draft.text.slice(0, 10_000) }));
}

export async function clearCardDraft(): Promise<void> {
  const storageKey = await key();
  if (storageKey) await AsyncStorage.removeItem(storageKey);
}
