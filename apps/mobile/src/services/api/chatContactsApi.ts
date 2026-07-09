import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatContact, CompanionMode } from "../../domain/chat/contacts";
import { DEFAULT_CHAT_CONTACT } from "../../domain/chat/contacts";
import type { TranslationKey } from "../../i18n";
import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const CONTACTS_CACHE_KEY = "linguaflow.chat.contacts.cache.v1";

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type ChatContactsPayload = {
  version: string;
  contacts: ChatContact[];
};

type ContactDto = {
  id: string;
  code?: string;
  nameKey: string;
  descriptionKey: string;
  nameFallback?: string;
  descriptionFallback?: string;
  avatarLabel?: string;
  enabled?: boolean;
  sortOrder?: number;
  historyContactIds?: string[];
  defaultCompanionMode?: CompanionMode;
  capabilities?: ChatContact["capabilities"];
};

export async function loadCachedChatContacts(): Promise<ChatContactsPayload | null> {
  const raw = await AsyncStorage.getItem(CONTACTS_CACHE_KEY);
  if (!raw) return null;
  try {
    return normalizePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function fetchChatContacts(): Promise<ChatContactsPayload> {
  const res = await fetch(`${BASE_URL}/chat/contacts`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<{ version: string; contacts: ContactDto[] }>;
  if (!json.ok) throw new Error(json.error.message);
  const payload = normalizePayload(json.data);
  if (!payload) throw new Error("Invalid contacts payload");
  await AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(payload));
  return payload;
}

function normalizePayload(value: unknown): ChatContactsPayload | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const version = typeof root.version === "string" && root.version.trim() ? root.version : "contacts_v1";
  if (!Array.isArray(root.contacts)) return null;
  const contacts = root.contacts
    .map(normalizeContact)
    .filter((contact): contact is ChatContact => !!contact);
  if (!contacts.length) return null;
  return { version, contacts };
}

function normalizeContact(value: unknown): ChatContact | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ContactDto;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id || row.enabled === false) return null;
  const historyContactIds = Array.isArray(row.historyContactIds)
    ? row.historyContactIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [id];
  return {
    ...DEFAULT_CHAT_CONTACT,
    id,
    code: typeof row.code === "string" ? row.code : id,
    nameKey: normalizeTranslationKey(row.nameKey, DEFAULT_CHAT_CONTACT.nameKey),
    descriptionKey: normalizeTranslationKey(row.descriptionKey, DEFAULT_CHAT_CONTACT.descriptionKey),
    nameFallback: typeof row.nameFallback === "string" ? row.nameFallback : DEFAULT_CHAT_CONTACT.nameFallback,
    descriptionFallback: typeof row.descriptionFallback === "string" ? row.descriptionFallback : DEFAULT_CHAT_CONTACT.descriptionFallback,
    avatarLabel: typeof row.avatarLabel === "string" && row.avatarLabel.trim() ? row.avatarLabel : DEFAULT_CHAT_CONTACT.avatarLabel,
    historyContactIds: Array.from(new Set([id, ...historyContactIds])),
    defaultCompanionMode: isCompanionMode(row.defaultCompanionMode) ? row.defaultCompanionMode : DEFAULT_CHAT_CONTACT.defaultCompanionMode,
    capabilities: row.capabilities ?? DEFAULT_CHAT_CONTACT.capabilities,
  };
}

function normalizeTranslationKey(value: unknown, fallback: TranslationKey): TranslationKey {
  return typeof value === "string" && value.trim() ? value as TranslationKey : fallback;
}

function isCompanionMode(value: unknown): value is CompanionMode {
  return value === "rewrite_only" || value === "native_note" || value === "simple_reply";
}
