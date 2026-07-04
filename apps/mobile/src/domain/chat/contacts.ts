import { t, type TranslationKey } from "../../i18n";

export type ChatContactId = string;
export type CompanionMode = "rewrite_only" | "native_note" | "simple_reply";

export type ChatContact = {
  id: ChatContactId;
  code?: string;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  nameFallback?: string;
  descriptionFallback?: string;
  avatarLabel: string;
  clozeSource: "tagged_en" | "tagged_en_reply" | "full_text";
  practiceEnabled: boolean;
  historyContactIds: string[];
  defaultCompanionMode?: CompanionMode;
  capabilities?: {
    companionMode?: boolean;
    practice?: boolean;
    dictionary?: boolean;
    tts?: boolean;
  };
};

export const LEGACY_CHAT_CONTACTS: ChatContact[] = [
  {
    id: "rewrite_assistant",
    code: "rewrite_assistant",
    nameKey: "contact.rewrite_assistant.name",
    descriptionKey: "contact.rewrite_assistant.description",
    avatarLabel: "CQN",
    clozeSource: "tagged_en",
    practiceEnabled: true,
    historyContactIds: ["rewrite_assistant"],
    defaultCompanionMode: "native_note",
  },
  {
    id: "english_friend",
    code: "english_friend",
    nameKey: "contact.english_friend.name",
    descriptionKey: "contact.english_friend.description",
    avatarLabel: "WHY",
    clozeSource: "tagged_en_reply",
    practiceEnabled: true,
    historyContactIds: ["english_friend"],
    defaultCompanionMode: "simple_reply",
  },
];

export const DEFAULT_CHAT_CONTACT: ChatContact = {
  id: "curious_companion",
  code: "curious_companion",
  nameKey: "contact.curious_companion.name",
  descriptionKey: "contact.curious_companion.description",
  nameFallback: "好奇伙伴",
  descriptionFallback: "改写、对照，也可以简单聊一句",
  avatarLabel: "OIO",
  clozeSource: "tagged_en",
  practiceEnabled: true,
  historyContactIds: ["curious_companion", "rewrite_assistant", "english_friend"],
  defaultCompanionMode: "rewrite_only",
  capabilities: {
    companionMode: true,
    practice: true,
    dictionary: true,
    tts: true,
  },
};

const LEGACY_CONTACT_MAP = new Map(LEGACY_CHAT_CONTACTS.map((contact) => [contact.id, contact]));

export const PRACTICE_CONTACTS = [DEFAULT_CHAT_CONTACT, ...LEGACY_CHAT_CONTACTS].filter((contact) => contact.practiceEnabled);

export function getChatContact(contactId: string | null | undefined, contacts: ChatContact[] = [DEFAULT_CHAT_CONTACT]): ChatContact {
  return contacts.find((contact) => contact.id === contactId) ?? LEGACY_CONTACT_MAP.get(contactId ?? "") ?? DEFAULT_CHAT_CONTACT;
}

export function getChatContactName(contact: Pick<ChatContact, "nameKey" | "nameFallback">): string {
  return t(contact.nameKey) || contact.nameFallback || contact.nameKey;
}

export function getChatContactDescription(contact: Pick<ChatContact, "descriptionKey" | "descriptionFallback">): string {
  return t(contact.descriptionKey) || contact.descriptionFallback || contact.descriptionKey;
}
